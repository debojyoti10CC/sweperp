import { MARKETS, MARKET, RANGE } from '../shared/markets.js';
import { AppError } from './errors.js';

const DAY = 86_400;
const MINUTE = 60;
const secondsNow = () => Math.floor(Date.now() / 1000);
const bucket = (time, seconds) => Math.floor(time / seconds) * seconds;
const roundPrice = value => Math.round(value * 100) / 100;

function candle(time, open, high, low, close, volume) {
  return { time, open, high, low, close, volume };
}

function seededTape(market, now) {
  let seed = market.symbol.charCodeAt(0) * 7633;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) - 0.5;
  const length = 31 * DAY / MINUTE;
  const end = bucket(now, MINUTE) - MINUTE;
  const result = [];
  let previous = market.practicePrice * 0.9;
  for (let i = length - 1; i >= 0; i--) {
    const days = i * MINUTE / DAY;
    const progress = 1 - Math.min(days, 1);
    const trend = days < 1
      ? -0.029 * days + Math.sin(progress * Math.PI) * (0.009 * Math.sin(progress * 11) + 0.009 * Math.sin(progress * 22))
      : -0.029 - (days - 1) * 0.0028 + Math.sin((days - 1) * 0.87) * 0.018;
    const close = roundPrice(market.practicePrice * (1 + trend + noise() * 0.0027));
    const wick = market.practicePrice * (0.00005 + Math.abs(noise()) * 0.0019);
    const high = roundPrice(Math.max(previous, close) + wick);
    const low = roundPrice(Math.min(previous, close) - wick);
    const volume = Math.round(15_000 * (0.25 + Math.abs(noise()) * 2 + Math.abs(close - previous) / market.practicePrice * 100) / market.practicePrice * 100) / 100;
    result.push(candle(end - i * MINUTE, roundPrice(previous), high, low, close, volume));
    previous = close;
  }
  return result;
}

function aggregate(tape, range) {
  const end = bucket(secondsNow(), range.seconds);
  const start = end - (range.count - 1) * range.seconds;
  const bars = [];
  for (const item of tape.slice(-Math.ceil(range.count * range.seconds / MINUTE) - 1)) {
    if (item.time < start) continue;
    const time = bucket(item.time, range.seconds);
    const last = bars.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, item.high);
      last.low = Math.min(last.low, item.low);
      last.close = item.close;
      last.volume += item.volume;
    } else bars.push({ ...item, time });
  }
  return bars;
}

function practiceFeed(controls) {
  const at = secondsNow();
  const series = Object.fromEntries(MARKETS.map(market => {
    const saved = controls.find(item => item._id === market.symbol);
    const tape = seededTape(market, at);
    const anchor = saved?.price ?? market.practicePrice;
    const open = tape.at(-1).close;
    tape.push(candle(bucket(at, MINUTE), open, Math.max(open, anchor), Math.min(open, anchor), anchor, 0));
    return [market.symbol, { anchor, tape, asOf: Date.now(), statsTime: 0 }];
  }));

  function record(state, price, volume = 0) {
    const time = bucket(secondsNow(), MINUTE);
    const last = state.tape.at(-1);
    if (last.time < time) {
      state.tape.push(candle(time, last.close, Math.max(last.close, price), Math.min(last.close, price), price, volume));
      // Keep a month of history even if the server runs continuously.
      if (state.tape.length > 45_000) state.tape.splice(0, 100);
    } else {
      last.close = price;
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.volume += volume;
    }
    state.asOf = Date.now();
  }

  function quote(symbol) {
    const state = series[symbol];
    const last = state.tape.at(-1);
    if (last.time !== state.statsTime) {
      const recent = state.tape.filter(item => item.time >= last.time - DAY && item.time < last.time);
      state.stats = recent.reduce((all, item) => ({
        open: all.open, high: Math.max(all.high, item.high), low: Math.min(all.low, item.low), volume: all.volume + item.volume,
      }), { open: recent[0]?.open ?? last.open, high: last.open, low: last.open, volume: 0 });
      state.statsTime = last.time;
    }
    const { open, high, low, volume } = state.stats;
    return {
      price: last.close, high: Math.max(high, last.high), low: Math.min(low, last.low), volume: volume + last.volume,
      change: (last.close / open - 1) * 100, asOf: state.asOf, stale: false,
    };
  }

  return {
    snapshot: () => Object.fromEntries(MARKETS.map(({ symbol }) => [symbol, quote(symbol)])),
    tick() {
      for (const [index, { symbol }] of MARKETS.entries()) {
        const state = series[symbol];
        const phase = Date.now() / 6500 + index;
        const price = Math.max(0.01, roundPrice(state.anchor * (1 + Math.sin(phase) * 0.00042 + Math.sin(phase * 0.4) * 0.00018)));
        record(state, price, 12 / price);
      }
    },
    candles: (symbol, range) => ({ candles: aggregate(series[symbol].tape, range), cached: false }),
    setPrice(symbol, price) {
      series[symbol].anchor = price;
      record(series[symbol], price);
    },
    stop() {},
  };
}

async function coinbase(product, endpoint) {
  const response = await fetch('https://api.exchange.coinbase.com/products/' + product + '/' + endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': 'PerpLab/1.0' },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('Coinbase HTTP ' + response.status);
  return response.json();
}

function liveFeed() {
  const quotes = {};
  const histories = new Map();
  const loading = new Map();
  let refreshing = false;
  let stopped = false;
  async function refresh() {
    if (refreshing || stopped) return;
    refreshing = true;
    await Promise.allSettled(MARKETS.map(async ({ symbol, product }) => {
      const [stats, ticker] = await Promise.all([coinbase(product, 'stats'), coinbase(product, 'ticker')]);
      const { price, high, low, volume, open } = {
        price: Number(ticker.price), high: Number(stats.high), low: Number(stats.low), volume: Number(stats.volume), open: Number(stats.open),
      };
      const asOf = Date.parse(ticker.time);
      if (![price, high, low, volume, open].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(asOf)) {
        throw new Error('Coinbase returned incomplete data');
      }
      quotes[symbol] = { price, high: Math.max(high, price), low: Math.min(low, price), volume, change: (price / open - 1) * 100, asOf, receivedAt: Date.now() };
    }));
    refreshing = false;
  }
  void refresh();
  const timer = setInterval(refresh, 5000);
  return {
    snapshot: () => Object.fromEntries(MARKETS.map(({ symbol }) => {
      const item = quotes[symbol];
      if (!item) return [symbol, null];
      const { receivedAt, ...quote } = item;
      return [symbol, { ...quote, stale: Date.now() - receivedAt > 18_000 || Date.now() - quote.asOf > 90_000 }];
    })),
    tick() {},
    async candles(symbol, range) {
      const key = symbol + range.id;
      const old = histories.get(key);
      if (old && Date.now() - old.at < 25_000) return { candles: old.candles, cached: false };
      if (!loading.has(key)) {
        const request = (async () => {
          const rows = await coinbase(MARKET[symbol].product, 'candles?granularity=' + range.seconds);
          const unique = new Map();
          for (const [time, low, high, open, close, volume] of rows) {
            if ([time, low, high, open, close, volume].every(Number.isFinite)) unique.set(time, candle(time, open, high, low, close, volume));
          }
          const bars = [...unique.values()].sort((a, b) => a.time - b.time).slice(-range.count);
          if (!bars.length) throw new Error('Empty candle data');
          histories.set(key, { candles: bars, at: Date.now() });
          return { candles: bars, cached: false };
        })().catch(() => {
          if (old) return { candles: old.candles, cached: true };
          throw new AppError(503, 'Price history is unavailable from Coinbase. Try again.');
        }).finally(() => loading.delete(key));
        loading.set(key, request);
      }
      return loading.get(key);
    },
    stop: () => { stopped = true; clearInterval(timer); },
  };
}

export function createMarketFeed(mode, controls) {
  return mode === 'live' ? liveFeed() : practiceFeed(controls);
}

export function resolveMarket(symbol) {
  if (!Object.hasOwn(MARKET, symbol)) throw new AppError(404, 'This market does not exist.');
  return MARKET[symbol];
}

export function resolveRange(range) {
  if (!Object.hasOwn(RANGE, range)) throw new AppError(400, 'Choose 1H, 1D, 1W, or 1M.');
  return RANGE[range];
}
