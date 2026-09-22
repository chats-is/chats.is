import { makeTestDb } from '@/test-utils/pg';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { pricingUpsertSchema } from '@/types/pricing';
import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: {} }));

const { updatePlan } = await import('./plan');
const { StaleEditError } = await import('./stale-edit');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  await h.db.delete(schema.plans);
  await h.db.delete(schema.quotas);
  await h.db
    .insert(schema.quotas)
    .values({ id: 'q1', name: 'Basic', isUnlimited: true });
  // Stamped by the database's own clock, microseconds and all — the way every
  // row that was ever created is.
  await h.db.execute(
    sql`insert into plan (id, name, quota_id, updated_at) values ('p1', 'Pro', 'q1', '2026-01-01 10:00:00.123456+00')`
  );
});

/** The row as an edit form would have it: read, and sent to a browser. */
const opened = async () => {
  const [row] = await h.db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, 'p1'));
  return new Date(JSON.parse(JSON.stringify(row.updatedAt)));
};

const nameNow = async () =>
  (await h.db.select().from(schema.plans).where(eq(schema.plans.id, 'p1')))[0]
    .name;

describe('saving over someone else’s change', () => {
  it('saves a form opened on the row as it still is', async () => {
    await updatePlan({
      id: 'p1',
      name: 'Pro+',
      expectedUpdatedAt: await opened()
    });

    expect(await nameNow()).toBe('Pro+');
  });

  it('refuses a form opened before somebody else saved', async () => {
    const mine = await opened();
    await updatePlan({ id: 'p1', name: 'Theirs', expectedUpdatedAt: mine });

    await expect(
      updatePlan({ id: 'p1', name: 'Mine', expectedUpdatedAt: mine })
    ).rejects.toBeInstanceOf(StaleEditError);
    expect(await nameNow()).toBe('Theirs');
  });

  it('does not check a caller that names no version', async () => {
    const mine = await opened();
    await updatePlan({ id: 'p1', name: 'Theirs', expectedUpdatedAt: mine });

    await updatePlan({ id: 'p1', name: 'Unchecked' });
    expect(await nameNow()).toBe('Unchecked');
  });
});

describe('the version a price form was opened on', () => {
  const price = { modelDbId: 'm1', source: 'manual' };

  it('tells "no price yet" apart from "not said"', () => {
    // `null` must survive: it is how a form says it was opened on a model with
    // no price, and a date coerced out of it would be 1970.
    expect(
      pricingUpsertSchema.parse({ ...price, expectedUpdatedAt: null })
        .expectedUpdatedAt
    ).toBeNull();
    expect(pricingUpsertSchema.parse(price).expectedUpdatedAt).toBeUndefined();
    expect(
      pricingUpsertSchema.parse({
        ...price,
        expectedUpdatedAt: '2026-01-01T10:00:00.123Z'
      }).expectedUpdatedAt
    ).toEqual(new Date('2026-01-01T10:00:00.123Z'));
  });
});
