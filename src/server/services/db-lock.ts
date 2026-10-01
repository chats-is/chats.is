import '@tanstack/react-start/server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db';

/** A transaction, as `db.transaction` hands it over. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What a query runs on: the database, or a transaction inside it. */
export type Executor = typeof db | Tx;

/**
 * Run `fn` in a transaction that holds the lock `key` names until it ends.
 *
 * A processor sends several webhooks about one thing at once — Paddle sends
 * `subscription.created` and `subscription.activated` together — and each
 * reads what is kept, compares, and writes. Unlocked, both read the old
 * state and both record the same change. Under one key they take turns.
 */
export async function withLock<T>(
  key: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    return await fn(tx);
  });
}
