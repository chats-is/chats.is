import { makeTestDb } from '@/test-utils/pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: {} }));

const { createPrompt, listUsablePrompts } = await import('./prompt');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;

  await h.db
    .insert(schema.users)
    .values({ id: 'u1', name: 'U', email: 'u@example.com' });
});

afterAll(async () => {
  await client?.close?.();
});

const base = { name: 'n', content: 'c', tags: [], displayOrder: 0 };

describe('a page of prompts', () => {
  /** A tag picked from a card narrows the gallery to the prompts carrying it. */
  it('lists only the prompts carrying a tag', async () => {
    await createPrompt(
      'u1',
      {
        ...base,
        name: 'tagged',
        tags: ['writing', 'email']
      },
      'private'
    );
    await createPrompt(
      'u1',
      { ...base, name: 'other', tags: ['code'] },
      'private'
    );
    const names = (rows: Array<{ name: string }>) => rows.map(row => row.name);
    expect(names(await listUsablePrompts('u1', { tag: 'email' }))).toEqual([
      'tagged'
    ]);
    expect(
      names(await listUsablePrompts('u1', { tag: 'code', search: 'oth' }))
    ).toEqual(['other']);
    expect(await listUsablePrompts('u1', { tag: 'none-such' })).toEqual([]);
  });
});
