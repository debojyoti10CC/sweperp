import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { Wallet } from 'ethers';
import WebSocket from 'ws';
import { startApp } from '../server/index.js';

test('paper trading over HTTP, WebSocket, and MongoDB', { timeout: 90_000 }, async t => {
  const tmp = await realpath(tmpdir());
  const dataPath = await mkdtemp(join(tmp, 'perplab-test-'));
  let running;
  const connections = [];
  t.after(async () => {
    for (const connection of connections) connection.terminate();
    if (running) await running.close();
    const path = await realpath(dataPath);
    if (dirname(path) === tmp && basename(path).startsWith('perplab-test-')) await rm(path, { recursive: true, force: true });
  });
  running = await startApp({ port: 0, dataPath });
  const wallet = Wallet.createRandom();
  let cookie;

  async function request(path, body, status = 200, options = {}) {
    const res = await fetch(running.url + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: options.origin ?? running.url }),
        ...(cookie && options.auth !== false ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    if (status !== null) assert.equal(res.status, status, JSON.stringify(data));
    return { status: res.status, data, cookie: res.headers.get('set-cookie') };
  }

  async function signIn() {
    const { data: challenge } = await request('/auth/challenge', { address: wallet.address, chainId: 1 });
    const body = { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) };
    const signed = await request('/auth/verify', body);
    cookie = signed.cookie.split(';')[0];
    return { challenge, signed, body };
  }

  let orderCounter = 0;
  const order = (overrides = {}) => ({
    symbol: 'SOL', side: 'long', quantity: 1, leverage: 5, stopLoss: null,
    clientOrderId: 'test-order-' + (++orderCounter), ...overrides,
  });
  const move = price => request('/practice/price', { symbol: 'SOL', price });
  const account = async () => (await request('/account')).data.account;

  await t.test('serves market history without signing in', async () => {
    assert.deepEqual((await request('/health')).data, { ok: true, database: 'Local MongoDB', mode: 'practice' });
    for (const [range, count] of [['1H', 60], ['1D', 96], ['1W', 168], ['1M', 30]]) {
      const { candles } = (await request('/markets/SOL/candles?range=' + range)).data;
      assert.equal(candles.length, count);
      for (const [i, bar] of candles.entries()) {
        assert.ok(bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close));
        if (i) assert.ok(candles[i - 1].time < bar.time);
      }
    }
  });

  await t.test('requires a valid, single-use wallet signature', async () => {
    await request('/orders', order(), 401);
    await request('/auth/challenge', { address: wallet.address, chainId: 1 }, 403, { origin: 'https://other.example' });
    const { data: challenge } = await request('/auth/challenge', { address: wallet.address, chainId: 1 });
    const wrongSignature = await Wallet.createRandom().signMessage(challenge.message);
    await request('/auth/verify', { nonce: challenge.nonce, signature: wrongSignature }, 401);
    const { signed, body } = await signIn();
    assert.match(signed.cookie, /HttpOnly; SameSite=Strict/);
    assert.equal(signed.data.account.available, 10_000);
    await request('/auth/verify', body, 401);
  });

  let stream;
  let frames = [];
  async function socket(headers) {
    const ws = new WebSocket(running.url.replace('http', 'ws') + '/ws', { origin: running.url, headers });
    connections.push(ws);
    await once(ws, 'open');
    return ws;
  }
  async function waitForFrame(predicate) {
    const saved = frames.findLast(predicate);
    if (saved) return saved;
    return new Promise((resolve, reject) => {
      const handler = data => {
        const message = JSON.parse(data);
        if (!predicate(message)) return;
        clearTimeout(timer);
        stream.off('message', handler);
        resolve(message);
      };
      const timer = setTimeout(() => { stream.off('message', handler); reject(new Error('WebSocket frame did not arrive')); }, 5000);
      stream.on('message', handler);
    });
  }

  await t.test('pushes public quotes and keeps account updates private', async () => {
    const guest = await socket();
    const [data] = await once(guest, 'message');
    const frame = JSON.parse(data);
    assert.equal(frame.account, null);
    assert.ok(frame.quotes.SOL.price > 0);
    guest.close();
    stream = await socket({ Cookie: cookie });
    stream.on('message', data => frames.push(JSON.parse(data)));
    const signed = await waitForFrame(frame => frame.account?.address === wallet.address);
    assert.equal(signed.account.available, 10_000);
  });

  await t.test('opens one order, streams profit, and settles the stop-loss', async () => {
    await move(160);
    await request('/orders', order({ stopLoss: 170 }), 400);
    await request('/orders', order({ symbol: 'BTC', quantity: 3, leverage: 1 }), 409);
    const body = order({ quantity: 2, stopLoss: 155 });
    const start = performance.now();
    const open = (await request('/orders', body, 201)).data.account;
    assert.ok(performance.now() - start < 2000, 'local order acknowledgment');
    assert.equal(open.positions.length, 1);
    assert.ok(open.available < 10_000);
    assert.equal(open.available + open.margin, 10_000);
    const repeated = (await request('/orders', body, 201)).data.account;
    assert.equal(repeated.version, open.version);
    await move(165);
    const up = await waitForFrame(frame => frame.account?.positions[0]?.pnl > 9);
    assert.ok(up.account.positions[0].markPrice >= 164.9);
    await move(154);
    const closed = await waitForFrame(frame => frame.account?.events?.[0]?.type === 'stopped');
    assert.equal(closed.account.positions.length, 0);
    assert.ok(closed.account.events[0].realizedPnl < -11);
    assert.equal(closed.account.available, 10_000 + closed.account.events[0].realizedPnl);
  });

  await t.test('caps liquidation losses at posted margin and supports manual close', async () => {
    const opened = (await request('/orders', order({ side: 'short', quantity: 5, leverage: 10 }), 201)).data.account;
    await move(180);
    const liquidated = await account();
    assert.equal(liquidated.events[0].type, 'liquidated');
    assert.equal(liquidated.events[0].realizedPnl, -opened.margin);
    assert.equal(liquidated.available, opened.available);
    const manual = (await request('/orders', order({ side: 'short' }), 201)).data.account.positions[0];
    await move(175);
    const closed = (await request('/positions/' + manual.id + '/close', {})).data.account;
    assert.equal(closed.events[0].type, 'closed');
    assert.ok(closed.events[0].realizedPnl > 4);
  });

  await t.test('rejects concurrent overspending and persists history on restart', async () => {
    const entries = await Promise.all([
      request('/orders', order({ quantity: 40, leverage: 1 }), null),
      request('/orders', order({ quantity: 40, leverage: 1 }), null),
    ]);
    assert.deepEqual(entries.map(item => item.status).sort(), [201, 409]);
    const before = await account();
    assert.equal(before.positions.length, 1);
    assert.ok(before.available > 0);
    stream.terminate();
    await running.close();
    running = null;
    running = await startApp({ port: 0, dataPath });
    const after = (await signIn()).signed.data.account;
    assert.equal(after.available, before.available);
    assert.equal(after.positions[0].id, before.positions[0].id);
    assert.deepEqual(after.events, before.events);
    assert.equal(after.positions[0].priceDelayed, false);
    assert.ok(Math.abs(after.positions[0].markPrice - 175) < 0.15, 'practice price persists');
    await request('/auth/logout', {});
    assert.equal((await request('/account')).data.account, null);
  });
});
