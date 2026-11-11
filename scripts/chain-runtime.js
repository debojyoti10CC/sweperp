import { readFile } from 'node:fs/promises';
import { BrowserProvider, ContractFactory, FetchRequest, JsonRpcProvider } from 'ethers';
import solc from 'solc';

export const DEVNET = { label: 'Local devnet', chainId: 31337 };
export const SEPOLIA = {
  label: 'Ethereum Sepolia', chainId: 11155111,
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io',
};

export function rpcProvider(url) {
  const request = new FetchRequest(url);
  request.timeout = 12_000;
  return new JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
}

export async function assertNetwork(provider, expected) {
  const id = Number(await provider.send('eth_chainId', []));
  if (id !== expected.chainId) throw new Error('Expected ' + expected.label + ' (chain ID ' + expected.chainId + ').');
}

export async function compileLedger() {
  const file = 'PerpLabLedger.sol';
  const content = await readFile(new URL('../contracts/' + file, import.meta.url), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [file]: { content } },
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter(item => item.severity === 'error');
  if (errors?.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'));
  const { abi, evm } = output.contracts[file].PerpLabLedger;
  return { abi, bytecode: '0x' + evm.bytecode.object };
}

export async function deployLedger(signer, { abi, bytecode }, onBroadcast) {
  const contract = await new ContractFactory(abi, bytecode, signer).deploy();
  const transaction = contract.deploymentTransaction();
  const deployment = { address: await contract.getAddress(), transactionHash: transaction.hash };
  if (onBroadcast) await onBroadcast(deployment);
  const receipt = await transaction.wait(1, 90_000);
  return { ...deployment, blockNumber: receipt.blockNumber };
}

export async function startLocalChain() {
  const { createHardhatRuntimeEnvironment } = await import('hardhat/hre');
  const hardhat = await createHardhatRuntimeEnvironment({
    networks: { perplab: { type: 'edr-simulated', chainType: 'l1', chainId: DEVNET.chainId } },
  });
  const connection = await hardhat.network.create('perplab');
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 250;
  return {
    provider,
    async stop() {
      provider.destroy();
      await connection.close();
    },
  };
}
