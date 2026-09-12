import '@tanstack/react-start/server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { models, prompts, providers, settings, users } from '@/db/schema';

/**
 * The nine numbers the console's home page shows, counted in one round trip.
 *
 * Gathering them a table at a time meant five queries and, for three of them,
 * reading every row so the browser could measure the array — the providers one
 * joining each provider's models along the way, none of which was ever looked
 * at. These are counts, so the database counts them.
 */
export async function countConsoleEntities() {
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
}
