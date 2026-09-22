import '@tanstack/react-start/server-only';

import { sql, type SQL } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';

import { PublicError } from '@/server/public-error';

/**
 * Saving over someone else's change.
 *
 * The console's edit forms are filled from the row on screen and written back
 * whole. Two admins with the same row open — or one admin with a tab that has
 * been open since morning — and the second to save silently undoes the first:
 * nothing compared what the form was opened on with what is there now.
 *
 * So a save says what it was opened on: the row's `updatedAt`, as the form saw
 * it. That goes into the write's own `where`, which makes the comparison and
 * the write one statement — no window between checking and saving, and no
 * lock held while someone thinks. A write that matches no row was opened on a
 * version that is gone.
 *
 * Optional throughout: a caller that sends nothing is not checked, which is
 * every caller that is not an edit form — a switch flipped in a table row is
 * one field and means what it says whenever it lands.
 */
export class StaleEditError extends PublicError {
  constructor(what: string) {
    super(
      `This ${what} was changed by someone else after you opened it. Close this, look at it again, and make your change to what is there now.`
    );
    this.name = 'StaleEditError';
  }
}

/**
 * A `where` condition holding the row to the version the form was opened on,
 * or nothing when the caller named none.
 *
 * Compared to the millisecond. The database keeps microseconds; a timestamp
 * that has been to a browser and back has lost them, and compared exactly it
 * would never match a row stamped by the database's own clock.
 */
export function unchangedSince(
  column: PgColumn,
  expected: Date | null | undefined
): SQL | undefined {
  if (!expected) return undefined;
  return sql`date_trunc('milliseconds', ${column}) = ${expected.toISOString()}::timestamptz`;
}

/** Refuse the save if the write found no row to change. Only meaningful when
 *  an expected version was named — callers check the row exists beforehand. */
export function assertWritten(
  written: ReadonlyArray<unknown>,
  expected: Date | null | undefined,
  what: string
) {
  if (expected && written.length === 0) throw new StaleEditError(what);
}
