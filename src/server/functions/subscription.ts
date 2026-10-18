import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { type z } from 'zod';

import {
  approveRefundRequestSchema,
  changePlanSchema,
  checkoutSchema,
  confirmCheckoutSchema,
  refundRequestListSchema,
  refundRequestSchema,
  rejectRefundRequestSchema,
  subscriptionIdSchema,
  subscriptionListSchema
} from '@/types/payment';
import { userIdSchema } from '@/types/user';
import { DEFAULT_PAGE_SIZE } from '@/lib/constant';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';
import * as subscription from '@/server/services/subscription';

/** The plans to subscribe to, with their prices and the models each opens —
 *  for anyone, since the site offers them before signing in. */
export const listPlansForSale = createServerFn({ method: 'GET' }).handler(() =>
  subscription.listPlansForSale()
);

/** The signed-in user's subscription, or null. */
export const getMySubscription = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(({ context }) => subscription.getMySubscription(context.user.id));

/** The checkout page for a plan; the page goes to the address returned. */
export const startCheckout = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(checkoutSchema)
  .handler(({ data, context }) =>
    subscription.startCheckout(context.user, data, getRequest())
  );

/** Back from a checkout with no subscription yet: ask its processor. */
export const confirmCheckout = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(confirmCheckoutSchema)
  .handler(({ data, context }) =>
    subscription.confirmCheckout(context.user, data)
  );

/** What an upgrade to a plan would charge today. */
export const previewUpgrade = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(changePlanSchema)
  .handler(({ data, context }) =>
    subscription.previewUpgrade(context.user.id, data)
  );

/** Move up to a plan that costs more, at the same interval; charged now. */
export const upgradePlan = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(changePlanSchema)
  .handler(({ data, context }) =>
    subscription.upgradePlan(context.user.id, data)
  );

export const cancelSubscription = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(({ context }) => subscription.cancelSubscription(context.user.id));

/** Resubscribe a canceled subscription, before it ends. */
export const resubscribe = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(({ context }) => subscription.resubscribe(context.user.id));

/** Whether the user can ask for a refund, the rules, the estimate, and
 *  where their latest request stands. */
export const getMyRefundRequest = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(({ context }) => subscription.getMyRefundRequest(context.user.id));

/** Ask for a refund: a request an admin decides on. */
export const submitRefundRequest = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(refundRequestSchema)
  .handler(({ data, context }) =>
    subscription.submitRefundRequest(context.user.id, data)
  );

/** How the signed-in user's subscription is paid for, from its processor. */
export const getMyPaymentMethod = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(({ context }) => subscription.getMyPaymentMethod(context.user.id));

/** The processor's page for changing the card. */
export const openPaymentMethods = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .handler(({ context }) =>
    subscription.openPaymentMethods(context.user.id, getRequest())
  );

/**
 * What Paddle.js needs to open a Paddle checkout on the app's own page. No
 * session: the client-side token is made to be public, and the page only
 * opens a transaction Paddle already holds.
 */
export const getPaddleCheckoutConfig = createServerFn({
  method: 'GET'
}).handler(async () => {
  const { paddleCheckoutConfig } =
    await import('@/server/services/payment-paddle');
  return await paddleCheckoutConfig();
});

/** Admin: every subscription, one page at a time. */
export const listSubscriptions = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(subscriptionListSchema)
  .handler(({ data }) => subscription.listSubscriptions(data));

/** Admin: one subscription, whole — its history, payments and refunds. */
export const getSubscriptionDetail = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(subscriptionIdSchema)
  .handler(({ data }) => subscription.getSubscriptionDetail(data.id));

/** Admin: cancel a subscription at the end of what was paid for. */
export const adminCancelSubscription = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(subscriptionIdSchema)
  .handler(({ data, context }) =>
    subscription.adminCancelSubscription(data.id, context.user.id)
  );

/** Admin: refund requests, one page at a time. */
export const listRefundRequests = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(refundRequestListSchema)
  .handler(({ data }) => subscription.listRefundRequests(data));

/** Admin: one refund request, with the payments it covers. */
export const getRefundRequest = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(subscriptionIdSchema)
  .handler(({ data }) => subscription.getRefundRequest(data.id));

/** Admin: approve a refund request with the amounts to refund. */
export const approveRefundRequest = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(approveRefundRequestSchema)
  .handler(({ data, context }) =>
    subscription.approveRefundRequest(data, context.user.id)
  );

/** Admin: reject a refund request. */
export const rejectRefundRequest = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(rejectRefundRequestSchema)
  .handler(({ data }) => subscription.rejectRefundRequest(data));

/** Admin: one user's subscription, for their detail page. */
export const getUserSubscription = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(userIdSchema)
  .handler(({ data }) => subscription.getMySubscription(data.id));

export const subscriptionQueries = {
  all: () => ['subscription'] as const,
  key: {
    mine: () => ['subscription', 'mine'] as const,
    refundRequest: () => ['subscription', 'refundRequest'] as const,
    paymentMethod: () => ['subscription', 'paymentMethod'] as const,
    refundRequests: () => ['subscription', 'refundRequests'] as const,
    plans: () => ['subscription', 'plans'] as const,
    list: () => ['subscription', 'list'] as const,
    detail: () => ['subscription', 'detail'] as const,
    user: () => ['subscription', 'user'] as const
  },
  plans: () =>
    queryOptions({
      queryKey: subscriptionQueries.key.plans(),
      queryFn: () => listPlansForSale()
    }),
  mine: () =>
    queryOptions({
      queryKey: subscriptionQueries.key.mine(),
      queryFn: () => getMySubscription()
    }),
  paymentMethod: () =>
    queryOptions({
      queryKey: subscriptionQueries.key.paymentMethod(),
      queryFn: () => getMyPaymentMethod(),
      // Changed in the processor's own tab: read again on coming back.
      refetchOnWindowFocus: true
    }),
  refundRequest: () =>
    queryOptions({
      queryKey: subscriptionQueries.key.refundRequest(),
      queryFn: () => getMyRefundRequest()
    }),
  refundRequests: (
    input: Partial<Omit<z.infer<typeof refundRequestListSchema>, 'page'>> & {
      page?: number;
    } = {}
  ) =>
    queryOptions({
      queryKey: [...subscriptionQueries.key.refundRequests(), input] as const,
      queryFn: () =>
        listRefundRequests({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      placeholderData: keepPreviousData
    }),
  refundRequestDetail: (id: string) =>
    queryOptions({
      queryKey: [
        ...subscriptionQueries.key.refundRequests(),
        'detail',
        id
      ] as const,
      queryFn: () => getRefundRequest({ data: { id } }),
      staleTime: 0
    }),
  list: (
    input: Partial<Omit<z.infer<typeof subscriptionListSchema>, 'page'>> & {
      page?: number;
    } = {}
  ) =>
    queryOptions({
      queryKey: [...subscriptionQueries.key.list(), input] as const,
      queryFn: () =>
        listSubscriptions({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      placeholderData: keepPreviousData
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...subscriptionQueries.key.detail(), id] as const,
      queryFn: () => getSubscriptionDetail({ data: { id } })
    }),
  user: (id: string) =>
    queryOptions({
      queryKey: [...subscriptionQueries.key.user(), id] as const,
      queryFn: () => getUserSubscription({ data: { id } })
    })
};
