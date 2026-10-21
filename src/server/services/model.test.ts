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
import { deleteModel } from '@/server/services/model';
import { createTier, getTier } from '@/server/services/tier';

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
  await h.db.delete(schema.tiers);
  await h.db.delete(schema.models);
  await h.db.insert(schema.models).values(
    ['a', 'b'].map(modelId => ({
      id: `m-${modelId}`,
      name: modelId,
      modelId,
      capability: 'chat'
    }))
  );
});

const tier = (
  name: string,
  modelRestrictionMode: 'allow' | 'deny',
  modelIds: string[]
) => createTier({ name, priceMultiplier: '1', modelRestrictionMode, modelIds });

describe('deleting a model', () => {
  it('takes it off every tier that names it', async () => {
    const allow = await tier('Allow', 'allow', ['a', 'b']);
    const deny = await tier('Deny', 'deny', ['a']);
    await deleteModel('m-a');
    expect((await getTier(allow.id))?.modelIds).toEqual(['b']);
    expect((await getTier(deny.id))?.modelIds).toEqual([]);
  });
});
