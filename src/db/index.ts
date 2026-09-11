import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import { env } from '@/lib/env';

import * as schema from './schema';

/**
 * Neon suspends an idle compute and drops its connections without telling the
 * pool, which goes on believing the socket it is holding is good. The next
 * query gets handed a dead one and fails — once, since the failure retires it
 * and the one after reconnects. That is the shape of the errors seen here:
 * random, always on whichever query happens to run first, gone on a refresh.
 *
 * So the pool lets go before Neon does. `idleTimeoutMillis` well under the
 * suspend window means an idle socket is closed by us, on our terms, rather
 * than found dead later; `maxUses` retires a long-lived one before it has
 * been around long enough for anything else to have gone wrong with it.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  idleTimeoutMillis: 10_000,
  maxUses: 1_000
});

export const db = drizzle(pool, { schema });
