import { type ModelCapability } from '@/types';

/**
 * A console table's filters, as the address spells them.
 *
 * Each table reads one page of a filtered query, so its route loader and its
 * component have to name the same page — one warms the cache the other reads.
 * The translation from search params to query input lives here once, so the two
 * cannot drift into asking for neighbouring keys.
 *
 * Kept out of the component modules deliberately: a non-component export
 * alongside a component costs Fast Refresh in development.
 */

/** A capability filter sitting at its default means "every capability". */
const capabilityOf = (capability: string | undefined) =>
  !capability || capability === 'all'
    ? undefined
    : (capability as ModelCapability);

/** A blank search box is no filter at all, not a search for nothing. */
const termOf = (q: string | undefined) => q?.trim() || undefined;

/** An absent page is the first one. */
const pageOf = (page: number | undefined) => page ?? 1;

type CapabilitySearch = { capability?: string; q?: string; page?: number };
/** A pricing filter beside the capability one: the models and the pricing
 *  tables both take it. */
type PricingSearch = CapabilitySearch & { priced?: string };

/** A priced filter sitting at its default means "every model". */
const pricedOf = (
  priced: string | undefined
): 'priced' | 'unpriced' | undefined =>
  priced === 'priced' || priced === 'unpriced' ? priced : undefined;
type SearchOnly = { q?: string; page?: number };
type PageOnly = { page?: number };

export const modelTableInput = (search: PricingSearch) => ({
  capability: capabilityOf(search.capability),
  priced: pricedOf(search.priced),
  q: termOf(search.q),
  page: pageOf(search.page)
});

export const pricingTableInput = (search: PricingSearch) => ({
  capability: capabilityOf(search.capability),
  priced: pricedOf(search.priced),
  q: termOf(search.q),
  page: pageOf(search.page)
});

export const providerTableInput = (search: SearchOnly) => ({
  q: termOf(search.q),
  page: pageOf(search.page)
});

/** Prompts and users narrow by `search` rather than `q` on the wire. */
export const promptTableInput = (search: SearchOnly) => ({
  search: termOf(search.q),
  page: pageOf(search.page)
});

export const userTableInput = (search: SearchOnly) => ({
  search: termOf(search.q),
  page: pageOf(search.page)
});

export const planTableInput = (search: PageOnly) => ({
  page: pageOf(search.page)
});

export const tierTableInput = (search: PageOnly) => ({
  page: pageOf(search.page)
});

export const quotaTableInput = (search: PageOnly) => ({
  page: pageOf(search.page)
});

/** Subscriptions narrow by status and processor beside the search; either
 *  at `all` is no filter. */
type SubscriptionSearch = SearchOnly & { status?: string; processor?: string };
const STATUSES = ['active', 'canceled'] as const;
const PROCESSORS = ['stripe', 'paddle', 'lemonsqueezy'] as const;
const oneOf = <T extends string>(options: readonly T[], value?: string) =>
  options.includes(value as T) ? (value as T) : undefined;

export const subscriptionTableInput = (search: SubscriptionSearch) => ({
  status: oneOf(STATUSES, search.status),
  processor: oneOf(PROCESSORS, search.processor),
  q: termOf(search.q),
  page: pageOf(search.page)
});

/** Payments narrow by status and processor beside the search; either at
 *  `all` is no filter. */
const PAYMENT_STATUSES = [
  'paid',
  'failed',
  'refund_pending',
  'refunded',
  'disputed'
] as const;
export const paymentTableInput = (search: SubscriptionSearch) => ({
  status: oneOf(PAYMENT_STATUSES, search.status),
  processor: oneOf(PROCESSORS, search.processor),
  q: termOf(search.q),
  page: pageOf(search.page)
});

/** Refund requests narrow by status beside the search; `all` is no
 *  filter. */
const REQUEST_STATUSES = ['pending_approval', 'approved', 'rejected'] as const;
export const refundRequestTableInput = (
  search: SearchOnly & { status?: string }
) => ({
  status: oneOf(REQUEST_STATUSES, search.status),
  q: termOf(search.q),
  page: pageOf(search.page)
});
