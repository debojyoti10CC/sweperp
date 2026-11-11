import { STARTING_BALANCE, UPDATE_MS } from '../shared/markets.js';
import { accountView, closePosition, openPosition, settleTriggered } from '../server/engine.js';
import { AppError } from '../server/errors.js';
import { createMarketFeed, readPracticePrice, resolveMarket, resolveRange } from '../server/market.js';

const STORAGE_KEY = 'perplab.browser-practice.v1';

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (saved?.prices && typeof saved.prices === 'object') return saved;
  } catch { /* start a new session when storage is unavailable */ }
  return { account: null, connected: false, prices: {} };
}

let state = restore();
const feed = createMarketFeed('practice', Object.entries(state.prices).map(([_id, price]) => ({ _id, price })));

function save(next) {
  state = next;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { /* keep the current session usable in memory */ }
}

function changeAccount(next) {
  if (next !== state.account) {
    save({ ...state, account: { ...next, version: state.account.version + 1 } });
  }
}

function requireAccount() {
  if (!state.connected || !state.account) throw new AppError(401, 'Start your practice account to trade.');
  return state.account;
}

const marketView = () => ({ mode: 'practice', quotes: feed.snapshot() });
const view = quotes => accountView(state.connected ? state.account : null, quotes);

export function connectPracticeAccount() {
  let account = state.account;
  if (!account) {
    const address = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('');
    account = { address, availableCents: STARTING_BALANCE * 100, positions: [], events: [], version: 0 };
  }
  save({ ...state, account, connected: true });
  return { account: view(feed.snapshot()) };
}

export function subscribePractice(listener) {
  function update() {
    feed.tick();
    const market = marketView();
    if (state.account?.positions.length) changeAccount(settleTriggered(state.account, market.quotes));
    listener({ ...market, account: view(market.quotes) });
  }
  update();
  const timer = setInterval(update, UPDATE_MS);
  return () => clearInterval(timer);
}

export function practiceRequest(path, body) {
  const url = new URL(path, location.origin);
  const resource = url.pathname;
  if (resource === '/markets') return marketView();
  const candles = /^\/markets\/([^/]+)\/candles$/.exec(resource);
  if (candles) {
    const { symbol } = resolveMarket(candles[1]);
    return feed.candles(symbol, resolveRange(url.searchParams.get('range') ?? '1D'));
  }
  if (resource === '/account') return { account: view(feed.snapshot()) };
  if (resource === '/auth/logout') {
    save({ ...state, connected: false });
    return { account: null };
  }
  if (resource === '/practice/price') {
    const account = requireAccount();
    const { symbol } = resolveMarket(body?.symbol);
    const price = readPracticePrice(body?.price);
    feed.setPrice(symbol, price);
    const market = marketView();
    save({ ...state, prices: { ...state.prices, [symbol]: price } });
    changeAccount(settleTriggered(account, market.quotes));
    return market;
  }
  const closing = /^\/positions\/([^/]+)\/close$/.exec(resource);
  if (resource === '/orders' || closing) {
    const account = requireAccount();
    const quotes = feed.snapshot();
    changeAccount(closing ? closePosition(account, closing[1], quotes) : openPosition(account, body ?? {}, quotes));
    return { account: view(quotes) };
  }
  throw new AppError(404, 'This operation is unavailable in browser practice.');
}
