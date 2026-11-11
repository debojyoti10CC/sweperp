import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Contract, Wallet } from 'ethers';
import { SiweMessage } from 'siwe';
import { startApp } from '../server/index.js';
import { openLedger } from '../server/onchain.js';
import { assertNetwork, compileLedger, deployLedger, DEVNET, startLocalChain } from '../scripts/chain-runtime.js';

test('settles and restores paper trades on the local devnet', { timeout: 60_000 }, async t => {
  const temporaryRoot = await realpath(tmpdir());
  const dataPath = await mkdtemp(join(temporaryRoot, 'perplab-chain-test-'));
  let chain, ledger, running, recovered;
  t.after(async () => {
    await running?.close();
    await recovered?.stop();
    await ledger?.stop();
    await chain?.stop();
    const path = await realpath(dataPath);
    if (dirname(path) === temporaryRoot && basename(path).startsWith('perplab-chain-test-')) {
      await rm(path, { recursive: true, force: true });
    }
  });
  chain = await startLocalChain();
  const { provider } = chain;
  await assertNetwork(provider, DEVNET);
  const signer = await provider.getSigner();
  const artifact = await compileLedger();
  const deployment = await deployLedger(signer, artifact);
  const settings = { provider, signer, deployment, abi: artifact.abi, network: DEVNET };
  ledger = await openLedger(settings);
  running = await startApp({ port: 0, dataPath, ledger });
  const contract = new Contract(deployment.address, artifact.abi, provider);
  const wallet = Wallet.createRandom();
  let cookie;

  async function request(path, body, status = 200) {
    const response = await fetch(running.url + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: running.url }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return { data, cookie: response.headers.get('set-cookie') };
  }

  const { data: { settlement } } = await request('/health');
  assert.equal(settlement.chainId, DEVNET.chainId);
  assert.equal(settlement.contract, deployment.address);
  await request('/auth/challenge', { address: wallet.address, chainId: 1 }, 400);
  const { data: challenge } = await request('/auth/challenge', { address: wallet.address, chainId: DEVNET.chainId });
  const signIn = new SiweMessage(challenge.message);
  assert.equal(signIn.chainId, DEVNET.chainId);
  assert.equal(signIn.domain, new URL(running.url).host);
  const verification = await request('/auth/verify', { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) });
  cookie = verification.cookie.split(';')[0];
  assert.match(cookie, /^perplab_session_31337=/);
  assert.equal(verification.data.account.available, 10_000);

  const movePrice = price => request('/practice/price', { symbol: 'SOL', price });
  const draft = { symbol: 'SOL', side: 'long', quantity: 2, leverage: 5, stopLoss: 155, clientOrderId: 'devnet-order-0001' };
  await movePrice(160);
  const { data: { account: opened } } = await request('/orders', draft, 201);
  assert.equal(opened.positions.length, 1);
  assert.equal(opened.available, Number(await contract.available(wallet.address)) / 100);
  const entry = opened.events[0];
  const receipt = await request('/chain/transactions/' + entry.txHash);
  assert.equal(receipt.data.status, 'confirmed');
  assert.ok(receipt.data.blockNumber > deployment.blockNumber);
  const repeated = await request('/orders', draft, 201);
  assert.equal(repeated.data.account.events[0].txHash, entry.txHash);
  assert.equal(repeated.data.account.positions.length, 1);

  const nonOperator = await provider.getSigner(1);
  await assert.rejects(contract.connect(nonOperator).exit(wallet.address, opened.positions[0].id, 16000), /Operator only/);
  await movePrice(165);
  const { data: { account: closed } } = await request('/positions/' + opened.positions[0].id + '/close', {});
  assert.equal(closed.positions.length, 0);
  assert.equal(closed.events[0].type, 'closed');
  assert.ok(closed.events[0].realizedPnl > 9);
  assert.equal((await provider.getTransactionReceipt(closed.events[0].txHash)).status, 1);

  await request('/orders', { ...draft, clientOrderId: 'devnet-order-0002' }, 201);
  await movePrice(154);
  let account;
  for (let attempt = 0; attempt < 30; attempt++) {
    account = (await request('/account')).data.account;
    if (account.events[0]?.type === 'stopped') break;
    await delay(100);
  }
  assert.equal(account.events[0].type, 'stopped');
  assert.equal(account.positions.length, 0);
  assert.equal(account.available, Number(await contract.available(wallet.address)) / 100);
  assert.equal((await provider.getTransactionReceipt(account.events[0].txHash)).status, 1);

  recovered = await openLedger(settings);
  assert.deepEqual(recovered.getAccount(wallet.address).events, account.events);
  assert.equal(recovered.getAccount(wallet.address).availableCents / 100, account.available);
});
