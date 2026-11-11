const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const size = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const sign = value => value > 0 ? '+' : value < 0 ? '−' : '';

export const money = value => value == null ? '—' : usd.format(value);
export const pnl = value => value == null ? '—' : sign(value) + usd.format(Math.abs(value));
export const percent = value => value == null ? '—' : sign(value) + Math.abs(value).toFixed(2) + '%';
export const number = value => value == null ? '—' : size.format(value);
export const shortNumber = value => value == null ? '—' : compact.format(value);
export const time = value => value == null ? '—' : clock.format(new Date(value));
export const dateTime = value => value == null ? '—' : date.format(new Date(value));
export const direction = value => value === 'long' ? 'Long' : 'Short';
export const tone = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
export const shortAddress = value => value.slice(0, 6) + '…' + value.slice(-4);
