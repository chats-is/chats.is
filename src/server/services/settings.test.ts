import { makeTestDb } from '@/test-utils/pg';
import { eq } from 'drizzle-orm';
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

const { bulkUpdateSettings, getSitePage, getSystemSettings } =
  await import('./settings');

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

describe('getSystemSettings for a tier', () => {
  beforeAll(async () => {
    await h.db.insert(schema.models).values({
      id: 'm2',
      name: 'Other',
      modelId: 'gpt-y',
      capability: 'chat',
      isEnabled: true
    });
    await h.db.insert(schema.modelProviders).values({
      id: 'b2',
      modelId: 'gpt-y',
      providerId: 'p1',
      isEnabled: true
    });
    await h.db
      .insert(schema.settings)
      .values({ id: 's-chat', key: 'default.chat.modelId', value: 'gpt-y' });
  });

  const chatIds = (s: Awaited<ReturnType<typeof getSystemSettings>>) =>
    s.chatModels.map(m => m.modelId).sort();

  it('offers every model without a tier', async () => {
    const s = await getSystemSettings();
    expect(chatIds(s)).toEqual(['gpt-x', 'gpt-y']);
  });

  it('offers only what an allow list names', async () => {
    const s = await getSystemSettings({
      modelRestrictionMode: 'allow',
      modelIds: ['gpt-x']
    });
    expect(chatIds(s)).toEqual(['gpt-x']);
  });

  it('keeps out what a deny list names', async () => {
    const s = await getSystemSettings({
      modelRestrictionMode: 'deny',
      modelIds: ['gpt-x']
    });
    expect(chatIds(s)).toEqual(['gpt-y']);
  });

  it('offers no model a call could not reach: its binding off, or its provider', async () => {
    await h.db.insert(schema.providers).values({
      id: 'p-off',
      name: 'Off',
      type: 'openai',
      apiKey: 'k',
      isEnabled: false
    });
    await h.db.insert(schema.models).values([
      {
        id: 'm-b',
        name: 'Binding off',
        modelId: 'gpt-b',
        capability: 'chat',
        isEnabled: true
      },
      {
        id: 'm-p',
        name: 'Provider off',
        modelId: 'gpt-p',
        capability: 'chat',
        isEnabled: true
      }
    ]);
    await h.db.insert(schema.modelProviders).values([
      { id: 'b-b', modelId: 'gpt-b', providerId: 'p1', isEnabled: false },
      { id: 'b-p', modelId: 'gpt-p', providerId: 'p-off', isEnabled: true }
    ]);

    expect(chatIds(await getSystemSettings())).toEqual(['gpt-x', 'gpt-y']);

    await h.db
      .update(schema.modelProviders)
      .set({ isEnabled: true })
      .where(eq(schema.modelProviders.id, 'b-b'));
    expect(chatIds(await getSystemSettings())).toEqual([
      'gpt-b',
      'gpt-x',
      'gpt-y'
    ]);
    await h.db.delete(schema.models).where(eq(schema.models.id, 'm-b'));
  });

  it('passes the admin’s default on as it is, for the page to settle', async () => {
    const s = await getSystemSettings({
      modelRestrictionMode: 'allow',
      modelIds: ['gpt-x']
    });
    expect(s.defaults.chatModelId).toBe('gpt-y');
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

describe('getSitePage', () => {
  it('shows what the operator wrote, and nothing when nothing is', async () => {
    await bulkUpdateSettings([{ key: 'pages.about', value: '# Hello\n\nUs.' }]);
    expect((await getSitePage('about')).markdown).toBe('# Hello\n\nUs.');

    await bulkUpdateSettings([{ key: 'pages.about', value: '  ' }]);
    expect((await getSitePage('about')).markdown).toBe('');
    expect((await getSitePage('terms')).markdown).toBe('');
  });
});
