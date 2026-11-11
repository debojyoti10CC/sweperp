import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { startApp } from '../server/index.js';
import { openLedger } from '../server/onchain.js';
import { assertNetwork, compileLedger, deployLedger, DEVNET, rpcProvider, SEPOLIA, startLocalChain } from './chain-runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function sepoliaSigner(provider, directory) {
  if (process.env.PERPLAB_SEPOLIA_OPERATOR_KEY) return new Wallet(process.env.PERPLAB_SEPOLIA_OPERATOR_KEY, provider);
  const file = join(directory, 'operator.json');
  if (!await readJson(file)) {
    try {
      await writeFile(file, JSON.stringify({ privateKey: Wallet.createRandom().privateKey }), { mode: 0o600, flag: 'wx' });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return new Wallet((await readJson(file)).privateKey, provider);
}

async function sepoliaDeployment(provider, signer, artifact, directory) {
  const address = await signer.getAddress();
  if (await provider.getBalance(address) === 0n) {
    throw new Error('Fund the Sepolia operator ' + address + ' with Sepolia ETH, then run npm run sepolia again. ' +
      'Faucets: https://ethereum.org/developers/docs/networks/#sepolia');
  }
  const file = join(directory, 'deployment-' + address.toLowerCase() + '.json');
  const previous = await readJson(file);
  if (previous?.blockNumber !== undefined) return previous;
  let deployed;
  if (previous) {
    const receipt = await provider.waitForTransaction(previous.transactionHash, 1, 90_000);
    if (receipt?.status === 1) deployed = { ...previous, blockNumber: receipt.blockNumber };
  }
  deployed ??= await deployLedger(signer, artifact, data => writeFile(file, JSON.stringify(data, null, 2)));
  await writeFile(file, JSON.stringify(deployed, null, 2));
  return deployed;
}

let running, chain, provider, ledger;
async function close() {
  await running?.close();
  await ledger?.stop();
  if (chain) await chain.stop();
  else provider?.destroy();
}

try {
  const envFile = join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const publicTestnet = process.argv.includes('--sepolia');
  const network = publicTestnet ? SEPOLIA : DEVNET;
  const directory = join(root, '.data', 'chain', publicTestnet ? 'sepolia' : 'devnet');
  await mkdir(directory, { recursive: true });
  console.log('Starting PerpLab on ' + network.label + '…');

  if (publicTestnet) provider = rpcProvider(process.env.PERPLAB_SEPOLIA_RPC_URL || SEPOLIA.rpcUrl);
  else {
    chain = await startLocalChain();
    provider = chain.provider;
  }
  await assertNetwork(provider, network);
  const artifact = await compileLedger();
  const signer = publicTestnet ? await sepoliaSigner(provider, directory) : await provider.getSigner(0);
  const deployment = publicTestnet
    ? await sepoliaDeployment(provider, signer, artifact, directory)
    : await deployLedger(signer, artifact);
  ledger = await openLedger({ provider, signer, deployment, abi: artifact.abi, network });
  running = await startApp({
    ledger, dev: true, port: Number(process.env.PORT || 4173), appOrigin: process.env.APP_ORIGIN,
    database: process.env.MONGODB_DB, mongoUri: process.env.MONGODB_URI,
    dataPath: process.env.PERPLAB_DATA_PATH || join(directory, 'mongo'),
  });
  console.log(network.label + ' • ' + running.url + ' • Contract ' + deployment.address);
  console.log('Deployment transaction: ' + deployment.transactionHash);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await close();
    process.exit(0);
  });
} catch (error) {
  // RPC errors can contain credentials in the endpoint URL.
  let message = error.shortMessage || error.message;
  for (const value of [process.env.PERPLAB_SEPOLIA_RPC_URL, process.env.PERPLAB_SEPOLIA_OPERATOR_KEY]) {
    if (value) message = message.replaceAll(value, '[configured value]');
  }
  console.error(message);
  await close();
  process.exitCode = 1;
}
