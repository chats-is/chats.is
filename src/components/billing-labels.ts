import {
  PAYMENT_KIND_LABELS,
  PAYMENT_PROCESSORS,
  type BillingInterval,
  type PaymentKind
} from '@/types/payment';

/** A processor's name as the pages show it. */
export function processorLabelOf(id: string): string {
  return PAYMENT_PROCESSORS.find(p => p.id === id)?.label ?? id;
}

/** "monthly" or "yearly". */
export const intervalLabelOf = (interval: BillingInterval | null) =>
  interval === 'year' ? 'yearly' : interval === 'month' ? 'monthly' : '';

/** What a payment was for. */
export const paymentKindLabelOf = (kind: PaymentKind) =>
  PAYMENT_KIND_LABELS[kind];
