import { randomUUID } from 'node:crypto';
import { LEVERAGES, MARKET } from '../shared/markets.js';
import { positionTerms, QUANTITY_SCALE as SCALE } from '../shared/risk.js';
import { AppError } from './errors.js';

const dollars = value => value / 100;
const quantity = value => value / SCALE;
const history = (account, event) => [event, ...account.events].slice(0, 200);
const pnlAt = (p, cents) => Math.round((cents - p.entryCents) * p.units / SCALE * (p.side === 'long' ? 1 : -1));

function scaled(input, scale, label) {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > 10_000_000) {
    throw new AppError(400, label + ' must be a positive number.');
  }
  const value = Math.round(input * scale);
  if (Math.abs(input * scale - value) > 1e-6) {
    throw new AppError(400, label + ' has too many decimal places.');
  }
  return value;
}

export function usablePrice(quote) {
  if (!quote || quote.stale || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new AppError(503, 'A current market price is unavailable. Try again when the feed reconnects.');
  }
  return Math.round(quote.price * 100);
}

export function openPosition(account, input, quotes) {
  const { symbol, side, leverage, clientOrderId } = input;
  const market = Object.hasOwn(MARKET, symbol) && MARKET[symbol];
  if (!market) throw new AppError(400, 'Choose SOL, BTC, or ETH.');
  if (side !== 'long' && side !== 'short') throw new AppError(400, 'Choose Long or Short.');
  if (!LEVERAGES.includes(leverage)) throw new AppError(400, 'Choose 1×, 2×, 5×, or 10× leverage.');
  if (typeof clientOrderId !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(clientOrderId)) {
    throw new AppError(400, 'The order identifier is missing. Submit the order again.');
  }
  if (account.events.some(event => event.clientOrderId === clientOrderId)) return account;
  if (account.positions.length >= 12) throw new AppError(409, 'Close a position before opening another. The limit is 12.');

  const units = scaled(input.quantity, SCALE, 'Quantity');
  if (units < Math.round(market.minQty * SCALE) || units > market.maxQty * SCALE ||
    units % Math.round(market.qtyStep * SCALE) !== 0) {
    throw new AppError(400, 'Enter ' + market.minQty + '–' + market.maxQty + ' ' + symbol + ' in steps of ' + market.qtyStep + '.');
  }
  const entryCents = usablePrice(quotes[symbol]);
  const { notionalCents, marginCents, liquidationCents } = positionTerms(entryCents, units, leverage, side);
  if (notionalCents < 100) throw new AppError(400, 'The order value must be at least $1.00.');
  if (marginCents > account.availableCents) throw new AppError(409, 'Insufficient available margin. Reduce the quantity or close a position.');
  const stopCents = input.stopLoss == null ? null : scaled(input.stopLoss, 100, 'Stop-loss price');
  if (stopCents !== null && (side === 'long' ? stopCents >= entryCents : stopCents <= entryCents)) {
    throw new AppError(400, side === 'long' ? 'A long stop-loss must be below the current price.' : 'A short stop-loss must be above the current price.');
  }
  if (stopCents !== null && (side === 'long' ? stopCents <= liquidationCents : stopCents >= liquidationCents)) {
    throw new AppError(400, 'Set the stop-loss closer to entry than the liquidation price.');
  }
  const openedAt = new Date().toISOString();
  const id = randomUUID();
  const position = { id, symbol, side, units, leverage, entryCents, marginCents, stopCents, liquidationCents, openedAt };
  return {
    ...account,
    availableCents: account.availableCents - marginCents,
    positions: [...account.positions, position],
    events: history(account, {
      id: randomUUID(), positionId: id, clientOrderId, type: 'opened', symbol, side,
      quantity: quantity(units), price: dollars(entryCents), realizedPnl: null, time: openedAt,
    }),
  };
}

function settle(account, position, priceCents, type) {
  const result = Math.max(-position.marginCents, pnlAt(position, priceCents));
  return {
    ...account,
    availableCents: account.availableCents + position.marginCents + result,
    positions: account.positions.filter(item => item.id !== position.id),
    events: history(account, {
      id: randomUUID(), positionId: position.id, type, symbol: position.symbol, side: position.side,
      quantity: quantity(position.units), price: dollars(priceCents), realizedPnl: dollars(result), time: new Date().toISOString(),
    }),
  };
}

export function closePosition(account, id, quotes) {
  const position = account.positions.find(p => p.id === id);
  if (!position) throw new AppError(404, 'This position is already closed or does not exist.');
  const priceCents = usablePrice(quotes[position.symbol]);
  return settle(account, position, priceCents, exitType(position, priceCents) || 'closed');
}

function exitType(p, price) {
  if (p.side === 'long' ? price <= p.liquidationCents : price >= p.liquidationCents) return 'liquidated';
  if (p.stopCents !== null && (p.side === 'long' ? price <= p.stopCents : price >= p.stopCents)) return 'stopped';
  return null;
}

export function settleTriggered(account, quotes) {
  let next = account;
  for (const p of account.positions) {
    const quote = quotes[p.symbol];
    if (!quote?.price || quote.stale) continue;
    const price = Math.round(quote.price * 100);
    const type = exitType(p, price);
    if (type) next = settle(next, p, price, type);
  }
  return next;
}

export function hasTriggered(positions, quotes) {
  return positions.some(p => {
    const quote = quotes[p.symbol];
    return quote?.price && !quote.stale && exitType(p, Math.round(quote.price * 100));
  });
}

export function accountView(account, quotes) {
  if (!account) return null;
  let margin = 0;
  let pnl = 0;
  let equity = account.availableCents;
  let hasMissingPrice = false;
  const positions = account.positions.map(p => {
    const quote = quotes[p.symbol];
    const markCents = quote?.price ? Math.round(quote.price * 100) : null;
    const result = markCents === null ? null : pnlAt(p, markCents);
    hasMissingPrice ||= result === null;
    margin += p.marginCents;
    pnl += result ?? 0;
    equity += Math.max(0, p.marginCents + (result ?? 0));
    return {
      id: p.id, symbol: p.symbol, side: p.side, leverage: p.leverage, quantity: quantity(p.units),
      entryPrice: dollars(p.entryCents), markPrice: markCents === null ? null : dollars(markCents),
      margin: dollars(p.marginCents), stopLoss: p.stopCents === null ? null : dollars(p.stopCents),
      liquidationPrice: dollars(p.liquidationCents), pnl: result === null ? null : dollars(result),
      roi: result === null ? null : result / p.marginCents * 100, priceDelayed: !quote || quote.stale,
    };
  });
  return {
    address: account.address, version: account.version, available: dollars(account.availableCents), margin: dollars(margin),
    equity: hasMissingPrice ? null : dollars(equity), unrealizedPnl: hasMissingPrice ? null : dollars(pnl),
    positions, events: account.events,
  };
}
