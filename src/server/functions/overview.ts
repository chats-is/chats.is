import { createServerFn } from '@tanstack/react-start';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { usageRangeSchema } from '@/types/usage';
import { adminMiddleware } from '@/server/middleware';
import { stepOf } from '@/server/services/db-utils';
import * as overview from '@/server/services/overview';

/** The console's home page over a window. */
export const adminOverview = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(usageRangeSchema)
  .handler(({ data }) =>
    overview.adminOverview(data.from, data.to, stepOf(data.hourly))
  );

export const overviewQueries = {
  all: () => ['overview'] as const,
  /** Key prefixes, shared by the readers and by anything that invalidates
   *  them, so the two can never drift apart. */
  key: {
    report: () => ['overview', 'report'] as const
  },
  report: (input: { from: Date; to?: Date; hourly?: boolean }) =>
    queryOptions({
      queryKey: [
        ...overviewQueries.key.report(),
        input.from.toISOString(),
        input.to?.toISOString() ?? null,
        input.hourly ?? false
      ] as const,
      queryFn: () => adminOverview({ data: input }),
      // A new window changes the key; the last one stays on screen until
      // the new one lands, rather than the page blanking.
      placeholderData: keepPreviousData
    })
};
