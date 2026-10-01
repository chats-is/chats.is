import { makeTestDb } from '@/test-utils/pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

/**
 * `getSystemSettings` is called without a session — a share link loads it for
 * someone with no account — and it is assembled from rows that hold far more
 * than a menu needs. What it may say is asserted against a real row, since the
 * types already claimed the answer was safe while the query said otherwise.
 */
const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: {} }));

const { bulkUpdateSettings, getSystemSettings } = await import('./settings');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;

  await h.db.insert(schema.providers).values({
    id: 'p1',
    name: 'Primary',
    type: 'openai',
    apiKey: 'CIPHERTEXT-OF-THE-KEY',
    baseUrl: 'https://gateway.internal.example/v1',
    apiOptions: { organization: 'org-secret' },
    isEnabled: true
  });
  await h.db.insert(schema.models).values({
    id: 'm1',
    name: 'Model',
    modelId: 'gpt-x',
    capability: 'chat',
    systemPrompt: 'OPERATOR-ONLY PROMPT',
    apiParams: { temperature: 0.2 },
    isEnabled: true
  });
  await h.db
    .insert(schema.modelProviders)
    .values({ id: 'b1', modelId: 'gpt-x', providerId: 'p1', isEnabled: true });
});

afterAll(async () => {
  await client?.close?.();
});

describe('getSystemSettings', () => {
  it('names the provider a menu draws, and nothing of how it is reached', async () => {
    const settings = await getSystemSettings();
    const [model] = settings.chatModels;

    expect(model.providers?.[0]?.provider).toEqual({
      id: 'p1',
      name: 'Primary',
      type: 'openai',
      image: null,
      isEnabled: true
    });

    const wire = JSON.stringify(settings);
    for (const secret of [
      'CIPHERTEXT-OF-THE-KEY',
      'gateway.internal.example',
      'org-secret',
      'OPERATOR-ONLY PROMPT',
      'apiKey',
      'apiParams'
    ]) {
      expect(wire).not.toContain(secret);
    }
  });
});

describe('bulkUpdateSettings', () => {
  const read = async () =>
    Object.fromEntries(
      (
        await h.db.query.settings.findMany({
          where: (t: typeof schema.settings, { like }: any) =>
            like(t.key, 'bulk.%')
        })
      ).map((row: { key: string; value: string | null }) => [
        row.key,
        row.value
      ])
    );

  it('writes keys that have a row and makes the ones that have none', async () => {
    await h.db
      .insert(schema.settings)
      .values({ id: 's-old', key: 'bulk.a', value: 'before' });

    await bulkUpdateSettings([
      { key: 'bulk.a', value: 'after' },
      { key: 'bulk.b', value: 'new' },
      { key: 'bulk.c', value: null }
    ]);

    expect(await read()).toEqual({
      'bulk.a': 'after',
      'bulk.b': 'new',
      'bulk.c': null
    });
    // The existing row is written in place, not replaced.
    const row = await h.db.query.settings.findFirst({
      where: (t: typeof schema.settings, { eq }: any) => eq(t.key, 'bulk.a')
    });
    expect(row?.id).toBe('s-old');
  });

  it('keeps the last value of a key named twice', async () => {
    await bulkUpdateSettings([
      { key: 'bulk.d', value: 'first' },
      { key: 'bulk.d', value: 'last' }
    ]);
    expect((await read())['bulk.d']).toBe('last');
  });

  it('refuses a value its setting cannot hold, and takes an empty one', async () => {
    await expect(
      bulkUpdateSettings([{ key: 'refunds.days', value: '16' }])
    ).rejects.toThrow('From 1 to 15 days');
    await expect(
      bulkUpdateSettings([{ key: 'refunds.fee', value: '12' }])
    ).rejects.toThrow('percentages offered');
    await expect(
      bulkUpdateSettings([{ key: 'refunds.maxRequests', value: '8' }])
    ).rejects.toThrow('numbers offered');
    await expect(
      bulkUpdateSettings([
        { key: 'refunds.fee', value: '10' },
        { key: 'refunds.days', value: null },
        { key: 'refunds.maxRequests', value: null }
      ])
    ).resolves.toBeUndefined();
  });

  it('does nothing when given nothing', async () => {
    await expect(bulkUpdateSettings([])).resolves.toBeUndefined();
  });
});
