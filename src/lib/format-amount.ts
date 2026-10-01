/**
 * A price in US dollars as a reader expects it: "$10.00". Prices are always
 * dollars — there is no other currency — and always to the cent, unlike a
 * cost, which `formatUsd` shows to every digit it has.
 */
export function formatPrice(amount: number | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number.isFinite(n) ? n : 0);
}
