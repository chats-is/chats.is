import { makeTestDb } from '@/test-utils/pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import * as schema from '@/db/schema';

/**
 * Who signed up over a window, against a real Postgres: by its close, in
 * it, and on each of its days.
 */

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: {} }));

const { userSummary } = await import('@/server/services/user');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

const DAY = 24 * 60 * 60 * 1000;
/** A fixed window of ten days, from midnight UTC. */
const T0 = new Date('2026-09-01T00:00:00Z');
const day = (n: number, hours = 0) =>
  new Date(T0.getTime() + n * DAY + hours * 60 * 60 * 1000);

beforeEach(async () => {
  await h.db.delete(schema.users);
});

async function signUp(id: string, createdAt: Date) {
  await h.db
    .insert(schema.users)
    .values({ id, name: id, email: `${id}@x.test`, createdAt });
}

describe('userSummary', () => {
  it('counts those signed up by the close, and those new in the window, by day', async () => {
    await signUp('before', day(-3));
    await signUp('first', day(0, 1));
    await signUp('again', day(0, 23));
    await signUp('later', day(6));
    // After the window: neither in it nor in its total.
    await signUp('after', day(12));

    const s = await userSummary(day(0), day(10));
    expect(s.total).toEqual({ users: 4, newUsers: 3 });
    // Only the days anyone signed up on, counted from 1.
    expect(s.days.sort((a, b) => a.day - b.day)).toEqual([
      { day: 1, newUsers: 2 },
      { day: 7, newUsers: 1 }
    ]);
  });
});
