import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import * as schema from '@/server/db/schema';

/**
 * Spin up an in-process Postgres (PGlite, WASM) with the real migrations
 * applied — a genuine Postgres engine, so timestamptz, FILTER aggregates, FKs
 * and numeric precision behave as in production. Used by integration tests to
 * exercise the actual SQL in lib/queries against real data.
 */
export async function makeTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: 'server/db/migrations' });
  return { db, client };
}
