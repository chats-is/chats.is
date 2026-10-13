import '@tanstack/react-start/server-only';

import { sql, type SQLWrapper } from 'drizzle-orm';

import { db } from '@/db';

/*
 * What the services share in reaching the database: the transaction types,
 * the lock their writes take turns under, and the fragments their figures
 * are summed with.
 */

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
    await lockIn(tx, key);
    return await fn(tx);
  });
}

/** Take the lock `key` names in a transaction already open, held until it
 *  ends — a second lock inside the first, on the one connection. */
export async function lockIn(tx: Tx, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * Which day after `since` an instant falls on, counted from 1, a day being
 * every 86,400 seconds from `since`; before it, 0 or less.
 */
export const dayOf = (since: Date, instant: SQLWrapper) =>
  sql<number>`(floor((extract(epoch from ${instant})::float8 - ${since.getTime() / 1000}::float8) / 86400) + 1)::int`;

/** A sum, as a number, and 0 over no rows. */
export const sumOf = (value: SQLWrapper) =>
  sql<number>`coalesce(sum(${value}), 0)::float8`.mapWith(Number);
