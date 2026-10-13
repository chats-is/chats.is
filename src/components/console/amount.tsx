import { AMOUNT_COLORS } from '@/lib/constant';
import { formatPrice } from '@/lib/format-amount';
import { formatUsd } from '@/lib/utils';

type AmountKind = 'revenue' | 'cost' | 'profit';

/**
 * An amount, in the format the project gives its kind: money earned, and the
 * profit left of it, to the cent as a price is (`formatPrice`); what calls
 * cost, to every digit as a model's money is (`formatUsd`).
 */
function amountText(kind: AmountKind, v: number) {
  if (kind === 'cost') return formatUsd(v);
  // A revenue is a payment spread over the days it pays for, an MRR a price
  // turned into a month, and a profit takes in a cost's fractions of a cent,
  // so to the cent each is most often rounded, and says so.
  const cents = v * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6
    ? formatPrice(v)
    : `≈ ${formatPrice(v)}`;
}

function amountColor(kind: AmountKind, v: number) {
  if (kind === 'profit') {
    return v < 0 ? AMOUNT_COLORS.loss : AMOUNT_COLORS.profit;
  }
  return AMOUNT_COLORS[kind].text;
}

export function Amount({ kind, value }: { kind: AmountKind; value: number }) {
  return (
    <span className={amountColor(kind, value)}>{amountText(kind, value)}</span>
  );
}
