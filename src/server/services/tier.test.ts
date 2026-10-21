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
import {
  createTier,
  getTier,
  getUserTier,
  listTiers,
  updateTier
} from '@/server/services/tier';

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

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
  await h.db.delete(schema.users);
  await h.db.delete(schema.tiers);
  await h.db.delete(schema.models);
  await h.db.insert(schema.models).values(
    ['a', 'b', 'c'].map(modelId => ({
      id: `m-${modelId}`,
      name: modelId,
      modelId,
      capability: 'chat'
    }))
  );
  await h.db
    .insert(schema.users)
    .values({ id: 'u1', name: 'u1', email: 'u1@test.com' });
});

const tier = (modelIds: string[]) => ({
  name: `t-${modelIds.join('')}`,
  priceMultiplier: '1',
  modelRestrictionMode: 'allow' as const,
  modelIds
});

describe("a tier's models", () => {
  it('are kept a row each and read back as the list of modelIds', async () => {
    const { id } = await createTier(tier(['b', 'a']));
    expect((await getTier(id))?.modelIds).toEqual(['a', 'b']);
    expect(
      (await listTiers({ page: 1, pageSize: 10 })).rows[0].modelIds
    ).toEqual(['a', 'b']);
  });

  it('are replaced by the list an update brings, and kept when it brings none', async () => {
    const { id } = await createTier(tier(['a', 'b']));
    await updateTier({ id, modelIds: ['c'] });
    expect((await getTier(id))?.modelIds).toEqual(['c']);

    await updateTier({ id, name: 'renamed' });
    expect(await getTier(id)).toMatchObject({
      name: 'renamed',
      modelIds: ['c']
    });

    await updateTier({ id, modelIds: [] });
    expect((await getTier(id))?.modelIds).toEqual([]);
  });

  it("are what the user's tier in force is read by", async () => {
    const { id } = await createTier(tier(['a']));
    await h.db.update(schema.users).set({ tierId: id });
    expect(await getUserTier('u1')).toMatchObject({
      modelRestrictionMode: 'allow',
      modelIds: ['a'],
      source: 'override'
    });
  });

  it('cannot name a model there is not', async () => {
    await expect(createTier(tier(['gone']))).rejects.toThrow();
  });
});
