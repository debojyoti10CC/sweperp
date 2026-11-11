export const MARKETS = [
  { symbol: 'SOL', name: 'Solana', product: 'SOL-USD', practicePrice: 164.82, minQty: 0.01, maxQty: 1000, qtyStep: 0.01 },
  { symbol: 'BTC', name: 'Bitcoin', product: 'BTC-USD', practicePrice: 67428.60, minQty: 0.0001, maxQty: 3, qtyStep: 0.0001 },
  { symbol: 'ETH', name: 'Ethereum', product: 'ETH-USD', practicePrice: 3468.70, minQty: 0.001, maxQty: 80, qtyStep: 0.001 },
];
export const MARKET = Object.fromEntries(MARKETS.map(item => [item.symbol, item]));
export const RANGES = [
  { id: '1H', seconds: 60, count: 60, label: '1 hour' },
  { id: '1D', seconds: 900, count: 96, label: '1 day' },
  { id: '1W', seconds: 3600, count: 168, label: '1 week' },
  { id: '1M', seconds: 86400, count: 30, label: '1 month' },
];
export const RANGE = Object.fromEntries(RANGES.map(item => [item.id, item]));
export const LEVERAGES = [1, 2, 5, 10];
export const STARTING_BALANCE = 10_000;
export const MAINTENANCE_RATE = 0.005;
export const UPDATE_MS = 800;
