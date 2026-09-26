/**
 * The price multiplier: what a user is charged, as a multiple of the cost
 * price the pricing table holds. It comes from the tier the user is on —
 * their own, their plan's, or the install's default.
 *
 * A multiplier is a revenue setting, not a price. A tier's is always above
 * 0 (the form and the schema see to that); these helpers still read unset,
 * blank or 0 as ×1, so nothing that reaches them can make a call free.
 */

/** The multiplier a stored or typed value amounts to. */
export function effectiveMultiplier(
  value: string | number | null | undefined
): number {
  if (value === null || value === undefined || value === '') return 1;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** A cost at the cost price, as charged: to the ten places costs are kept. */
export function applyMultiplier(baseCost: number, multiplier: number): number {
  return Math.round(baseCost * multiplier * 1e10) / 1e10;
}

/** Whether a value sets a multiplier at all: anything above 0 does, and 1
 *  is one that happens to equal the cost price. */
export function hasMultiplier(
  value: string | number | null | undefined
): boolean {
  if (value === null || value === undefined || value === '') return false;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

/** A tier's multiplier as the console names it: "× 1.5" — "× 1" for one
 *  set to 1 — or the cost price where none is set. */
export function describeMultiplier(
  value: string | number | null | undefined
): string {
  return hasMultiplier(value)
    ? `× ${effectiveMultiplier(value)}`
    : 'Cost price';
}
