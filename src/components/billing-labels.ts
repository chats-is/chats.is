import {
  billingIntervalOf,
  type BillingInterval,
  type PaymentKind
} from '@/types/payment';
import { PAYMENT_KIND_LABELS, PAYMENT_PROCESSORS } from '@/lib/constant';

/** A processor's name as the pages show it. */
export function processorLabelOf(id: string): string {
  return PAYMENT_PROCESSORS.find(p => p.id === id)?.label ?? id;
}

/** "daily", "weekly", "monthly" or "yearly". */
export const intervalLabelOf = (interval: BillingInterval | null) =>
  interval ? billingIntervalOf(interval).adverb : '';

/** What a payment was for. */
export const paymentKindLabelOf = (kind: PaymentKind) =>
  PAYMENT_KIND_LABELS[kind];
