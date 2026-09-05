import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { sql } from 'drizzle-orm';

import { db } from '@/server/db';
import {
  models,
  prompts,
  providers,
  settings,
  users
} from '@/server/db/schema';
import { adminMiddleware } from '@/server/middleware';

/**
 * The counts behind the console's home page.
 *
 * The page shows nine numbers. Gathering them a table at a time meant five
 * round trips and, for three of them, reading every row so the browser could
 * measure the array — the providers one joining each provider's models along
 * the way, none of which was ever looked at. These are counts, so the database
 * counts them, and one call carries the lot.
 */
export const getConsoleOverview = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    const count = sql<number>`count(*)`.mapWith(Number);

    const [providerRows, modelRows, promptRows, settingRows, userRows] =
      await Promise.all([
        db
          .select({
            total: count,
            enabled:
              sql<number>`count(*) filter (where ${providers.isEnabled})`.mapWith(
                Number
              )
          })
          .from(providers),
        db
          .select({
            total: count,
            enabled:
              sql<number>`count(*) filter (where ${models.isEnabled})`.mapWith(
                Number
              )
          })
          .from(models),
        db
          .select({
            total: count,
            public:
              sql<number>`count(*) filter (where ${prompts.visibility} = 'public')`.mapWith(
                Number
              ),
            private:
              sql<number>`count(*) filter (where ${prompts.visibility} = 'private')`.mapWith(
                Number
              )
          })
          .from(prompts),
        db.select({ total: count }).from(settings),
        db
          .select({
            total: count,
            admins:
              sql<number>`count(*) filter (where ${users.role} = 'admin')`.mapWith(
                Number
              )
          })
          .from(users)
      ]);

    return {
      providers: providerRows[0] ?? { total: 0, enabled: 0 },
      models: modelRows[0] ?? { total: 0, enabled: 0 },
      prompts: promptRows[0] ?? { total: 0, public: 0, private: 0 },
      settings: settingRows[0] ?? { total: 0 },
      users: userRows[0] ?? { total: 0, admins: 0 }
    };
  });

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
