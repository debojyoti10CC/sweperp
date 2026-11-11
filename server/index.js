import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { UPDATE_MS } from '../shared/markets.js';
import { walletAuth } from './auth.js';
import { accountView, closePosition, hasTriggered, openPosition, settleTriggered } from './engine.js';
import { AppError } from './errors.js';
import { createMarketFeed, resolveMarket, resolveRange } from './market.js';
import { openStore } from './store.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultDatabase = 'kimia_lab'; // Keep accounts created during the initial local preview.

export async function startApp({
  port = 4173, mode = 'practice', dev = false, mongoUri, database = defaultDatabase,
  dataPath = resolve(root, '.data', 'mongo'), appOrigin, ledger,
} = {}) {
  const store = await openStore({ uri: mongoUri, database, dataPath, mode });
  const market = createMarketFeed(mode, mode === 'practice' ? await store.controls.find().toArray() : []);
  const accountStore = ledger ?? store;
  const network = ledger ? { settlement: ledger.network } : {};
  const auth = walletAuth({ ...store, ensureAccount: accountStore.ensureAccount }, ledger?.network.chainId);
  const app = express();
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  let origins = [];
  let queue = Promise.resolve();
  let ticking = false;
  let settling;
  let lastLog = 0;
  let vite;
  let timer;

  const marketView = () => ({ mode, quotes: market.snapshot(), ...network });

  function frame(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }

  function reportUpdateFailure(error) {
    if (Date.now() - lastLog > 15_000) {
      lastLog = Date.now();
      console.error('Market update failed:', error.message);
    }
  }

  async function settlePositions(quotes) {
    const candidates = await accountStore.activeAccounts();
    const triggered = candidates.filter(account => hasTriggered(account.positions, quotes));
    await Promise.all(triggered.map(account => accountStore.changeAccount(account._id, current => settleTriggered(current, quotes))));
  }

  async function publish() {
    const markets = marketView();
    if (ledger) {
      // Keep the market stream moving while an automatic exit waits to be mined.
      if (!settling) settling = settlePositions(markets.quotes).catch(reportUpdateFailure).finally(() => { settling = null; });
    } else {
      await settlePositions(markets.quotes);
    }

    const clients = [...sockets.clients].filter(socket => {
      if (socket.expiresAt && +socket.expiresAt <= Date.now()) {
        socket.close(4001, 'Session expired');
        return false;
      }
      return socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 128 * 1024;
    });
    if (!clients.length) return;
    const ids = [...new Set(clients.map(socket => socket.accountId).filter(Boolean))];
    const accounts = ids.length ? await accountStore.getAccounts(ids) : [];
    const views = new Map(accounts.map(account => [account._id, accountView(account, markets.quotes)]));
    for (const socket of clients) {
      const account = views.get(socket.accountId);
      if (account && socket.lastVersion === account.version) {
        const { events, ...update } = account;
        socket.send(JSON.stringify({ ...markets, account: update }));
      } else {
        socket.lastVersion = account?.version;
        socket.send(JSON.stringify({ ...markets, account: account ?? null }));
      }
    }
  }

  app.disable('x-powered-by');
  app.use('/api', express.json({ limit: '8kb' }), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !origins.includes(req.get('origin'))) {
      return next(new AppError(403, 'Open PerpLab from its local app URL.'));
    }
    if (req.method === 'POST' && req.body !== undefined &&
        (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return next(new AppError(400, 'A JSON object is required.'));
    }
    next();
  });

  async function signedIn(req) {
    const session = await auth.session(req);
    if (!session || session.origin !== req.get('origin')) throw new AppError(401, 'Connect your wallet to trade.');
    return session;
  }

  app.get('/api/health', async (req, res) => {
    await store.accounts.findOne({}, { projection: { _id: 1 }, maxTimeMS: 1000 });
    res.json({ ok: true, database: store.storage, mode, ...network });
  });
  app.get('/api/markets', (req, res) => res.json(marketView()));
  app.get('/api/markets/:symbol/candles', async (req, res) => {
    const { symbol } = resolveMarket(req.params.symbol);
    const range = resolveRange(req.query.range ?? '1D');
    res.json(await market.candles(symbol, range));
  });
  app.get('/api/account', async (req, res) => {
    const session = await auth.session(req);
    const account = session ? await accountStore.getAccount(session.accountId) : null;
    res.json({ account: accountView(account, market.snapshot()) });
  });
  app.post('/api/auth/challenge', async (req, res) => {
    res.json(await auth.challenge(req.body ?? {}, req.get('origin')));
  });
  app.post('/api/auth/verify', async (req, res) => {
    const { token, account } = await auth.verify(req.body ?? {}, req.get('origin'));
    auth.cookie(res, req.get('origin'), token);
    res.json({ account: accountView(account, market.snapshot()) });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const id = await auth.logout(req);
    for (const socket of sockets.clients) {
      if (id && socket.sessionId === id) socket.close(4001, 'Signed out');
    }
    auth.cookie(res, req.get('origin'));
    res.json({ account: null });
  });
  app.post('/api/orders', async (req, res) => {
    const session = await signedIn(req);
    const quotes = market.snapshot();
    const account = await accountStore.changeAccount(session.accountId, current => openPosition(current, req.body ?? {}, quotes));
    res.status(201).json({ account: accountView(account, quotes) });
  });
  app.post('/api/positions/:id/close', async (req, res) => {
    const session = await signedIn(req);
    const quotes = market.snapshot();
    const account = await accountStore.changeAccount(session.accountId, current => closePosition(current, req.params.id, quotes));
    res.json({ account: accountView(account, quotes) });
  });
  app.post('/api/practice/price', async (req, res) => {
    if (mode !== 'practice') throw new AppError(404, 'Price controls are available in practice mode.');
    await signedIn(req);
    const { symbol } = resolveMarket(req.body?.symbol);
    const price = req.body?.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0.01 || price > 2_000_000 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) {
      throw new AppError(400, 'Enter a price between $0.01 and $2,000,000 with up to two decimals.');
    }
    await frame(async () => {
      await store.controls.updateOne({ _id: symbol }, { $set: { price } }, { upsert: true });
      market.setPrice(symbol, price);
      await publish();
    });
    res.json(marketView());
  });
  if (ledger) {
    app.get('/api/chain/transactions/:hash', async (req, res) => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.hash)) throw new AppError(400, 'Enter a valid transaction hash.');
      const receipt = await ledger.receipt(req.params.hash);
      if (!receipt) throw new AppError(404, 'This transaction has not been recorded by the PerpLab contract.');
      res.json(receipt);
    });
  }
  app.use('/api', (req, res) => res.status(404).json({ error: 'This endpoint does not exist.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request contains invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
    console.error('Request failed:', error.message);
    res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
  });

  server.on('upgrade', async (req, socket, head) => {
    if (req.url !== '/ws') return;
    socket.on('error', () => socket.destroy());
    if (!origins.includes(req.headers.origin)) return socket.destroy();
    try {
      const session = await auth.session(req);
      const user = session?.origin === req.headers.origin ? session : null;
      if (socket.destroyed) return;
      sockets.handleUpgrade(req, socket, head, ws => {
        ws.on('error', () => ws.terminate());
        ws.accountId = user?.accountId;
        ws.sessionId = user?._id;
        ws.expiresAt = user?.expiresAt;
      });
    } catch {
      socket.destroy();
    }
  });

  try {
    if (dev) {
      const { createServer: createViteServer } = await import('vite');
      vite = await createViteServer({
        root, appType: 'spa', server: { middlewareMode: true, hmr: { server } },
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(resolve(root, 'dist')));
      app.get('/', (req, res) => res.status(503).send('Build PerpLab with npm run build, then reload.'));
    }
    await new Promise((ready, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', ready);
    });
    const address = server.address();
    const url = 'http://127.0.0.1:' + address.port;
    origins = appOrigin ? [new URL(appOrigin).origin] : [url, 'http://localhost:' + address.port];
    timer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      frame(async () => {
        market.tick();
        await publish();
      }).catch(reportUpdateFailure).finally(() => { ticking = false; });
    }, UPDATE_MS);
    return {
      url,
      async close() {
        clearInterval(timer);
        market.stop();
        for (const socket of sockets.clients) socket.terminate();
        sockets.close();
        if (vite) await vite.close();
        await new Promise(done => server.close(done));
        await queue;
        await settling;
        await store.stop();
      },
    };
  } catch (error) {
    market.stop();
    if (vite) await vite.close();
    await store.stop();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv.includes('--live') ? 'live' : 'practice';
    const envFile = resolve(root, '.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    console.log('Starting PerpLab and connecting to MongoDB…');
    const running = await startApp({
      port: Number(process.env.PORT || 4173), mode, dev: process.argv.includes('--dev'),
      mongoUri: process.env.MONGODB_URI, database: process.env.MONGODB_DB || defaultDatabase,
      dataPath: process.env.PERPLAB_DATA_PATH, appOrigin: process.env.APP_ORIGIN,
    });
    console.log('PerpLab • ' + running.url + ' • ' + (mode === 'live' ? 'Coinbase prices' : 'Practice feed'));
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await running.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Could not start PerpLab:', error.message);
    console.error('If local MongoDB cannot start, set MONGODB_URI in .env to an available MongoDB server.');
    process.exitCode = 1;
  }
}
