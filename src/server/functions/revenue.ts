import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { revenueLossUsersSchema } from '@/types/revenue';
import { usageRangeSchema } from '@/types/usage';
import { DEFAULT_PAGE_SIZE } from '@/lib/constant';
import { adminMiddleware } from '@/server/middleware';
import { stepOf } from '@/server/services/db-utils';
import * as revenue from '@/server/services/revenue';

/** The console's Revenue page over a window. */
export const adminRevenue = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageRangeSchema)
  .handler(({ data }) =>
    revenue.adminRevenue(data.from, data.to, stepOf(data.hourly))
  );

/** One page of the users the business lost money on over a window. */
export const adminRevenueLossUsers = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(revenueLossUsersSchema)
  .handler(({ data }) => revenue.adminRevenueLossUsers(data));

export const revenueQueries = {
  all: () => ['revenue'] as const,
  /** Key prefixes, shared by the readers and by anything that invalidates
   *  them, so the two can never drift apart. */
  key: {
    report: () => ['revenue', 'report'] as const,
    lossUsers: () => ['revenue', 'lossUsers'] as const
  },
  report: (input: { from: Date; to?: Date; hourly?: boolean }) =>
    queryOptions({
      queryKey: [
        ...revenueQueries.key.report(),
        input.from.toISOString(),
        input.to?.toISOString() ?? null,
        input.hourly ?? false
      ] as const,
      queryFn: () => adminRevenue({ data: input }),
      // A new window changes the key; the last one stays on screen until
      // the new one lands, rather than the page blanking.
      placeholderData: keepPreviousData
    }),
  lossUsers: (input: { from: Date; to?: Date; page?: number }) =>
    queryOptions({
      queryKey: [
        ...revenueQueries.key.lossUsers(),
        input.from.toISOString(),
        input.to?.toISOString() ?? null,
        input.page ?? 1
      ] as const,
      queryFn: () =>
        adminRevenueLossUsers({
          data: { page: 1, pageSize: DEFAULT_PAGE_SIZE, ...input }
        }),
      placeholderData: keepPreviousData
    })
};
