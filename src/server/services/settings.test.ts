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

const { getSystemSettings } = await import('./settings');

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
