import { MAINTENANCE_RATE } from './markets.js';

export const QUANTITY_SCALE = 10_000;

export function positionTerms(entryCents, units, leverage, side) {
  const notionalCents = Math.round(entryCents * units / QUANTITY_SCALE);
  const marginCents = Math.ceil(notionalCents / leverage);
  const maintenanceCents = Math.ceil(notionalCents * MAINTENANCE_RATE);
  const distance = Math.ceil((marginCents - maintenanceCents) * QUANTITY_SCALE / units);
  const liquidationCents = side === 'long' ? Math.max(1, entryCents - distance) : entryCents + distance;
  return { notionalCents, marginCents, liquidationCents };
}
