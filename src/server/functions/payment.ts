import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import {
  paymentIdSchema,
  paymentListSchema,
  refundPaymentSchema
} from '@/types/payment';
import { DEFAULT_PAGE_SIZE } from '@/lib/constant';
import { adminMiddleware, authedMiddleware } from '@/server/middleware';
import * as payment from '@/server/services/payment';
import * as subscription from '@/server/services/subscription';

/** The signed-in user's payments, newest first. */
export const listMyPayments = createServerFn({ method: 'GET' })
  .middleware([authedMiddleware])
  .handler(({ context }) => payment.listMyPayments(context.user.id));

/** Admin: every payment, one page at a time. */
export const listPayments = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(paymentListSchema)
  .handler(({ data }) => payment.listPayments(data));

/** The signed-in user's invoice for one of their own payments. */
export const openMyInvoice = createServerFn({ method: 'POST' })
  .middleware([authedMiddleware])
  .validator(paymentIdSchema)
  .handler(({ data, context }) =>
    payment.openInvoice(data.id, context.user.id)
  );

/** Admin: a payment's invoice, made by the processor when asked. */
export const openInvoice = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(paymentIdSchema)
  .handler(({ data }) => payment.openInvoice(data.id));

/** Admin: a payment as an admin acts on it — what was paid, kept, refunded
 *  and left, what the refund fee suggests, and its subscription. */
export const getRefundDetails = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(paymentIdSchema)
  .handler(({ data }) => subscription.getRefundDetails(data.id));

/** Admin: refund a payment, and end its subscription or cancel it. */
export const refundPayment = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(refundPaymentSchema)
  .handler(({ data, context }) =>
    subscription.refundPayment(data, context.user.id)
  );

export const paymentQueries = {
  all: () => ['payment'] as const,
  key: {
    mine: () => ['payment', 'mine'] as const,
    list: () => ['payment', 'list'] as const,
    refundDetails: () => ['payment', 'refundDetails'] as const
  },
  refundDetails: (id: string) =>
    queryOptions({
      queryKey: [...paymentQueries.key.refundDetails(), id] as const,
      queryFn: () => getRefundDetails({ data: { id } }),
      // Read afresh each time the dialog opens: what is left changes.
      staleTime: 0
    }),
  mine: () =>
    queryOptions({
      queryKey: paymentQueries.key.mine(),
      queryFn: () => listMyPayments()
    }),
  list: (input: { page?: number; pageSize?: number } = {}) =>
    queryOptions({
      queryKey: [...paymentQueries.key.list(), input] as const,
      queryFn: () =>
        listPayments({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      placeholderData: keepPreviousData
    })
};
