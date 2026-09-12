import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';

import { adminMiddleware } from '@/server/middleware';
import * as overview from '@/server/services/overview';

/** The counts behind the console's home page. */
export const getConsoleOverview = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(() => overview.getConsoleOverview());

export const overviewQueries = {
  /** Key prefixes, shared by the readers and by anything that invalidates
   *  them, so the two can never drift apart. */
  key: { console: () => ['overview', 'console'] as const },
  console: () =>
    queryOptions({
      queryKey: overviewQueries.key.console(),
      queryFn: () => getConsoleOverview()
    })
};
