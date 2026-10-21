import { makeTestDb } from '@/test-utils/pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: {} }));

const { createPrompt, listUsablePrompts, updatePrompt } =
  await import('./prompt');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;

  await h.db
    .insert(schema.users)
    .values({ id: 'u1', name: 'U', email: 'u@example.com' });
  // An image model that cannot edit, a chat model, a video model that edits
  // video, and an audio model that transcribes.
  await h.db.insert(schema.models).values([
    { id: 'm-image', name: 'Painter', modelId: 'painter', capability: 'image' },
    { id: 'm-chat', name: 'Talker', modelId: 'talker', capability: 'chat' },
    {
      id: 'm-video',
      name: 'Director',
      modelId: 'director',
      capability: 'video',
      supportsVideoEdit: true
    },
    {
      id: 'm-stt',
      name: 'Ears',
      modelId: 'ears',
      capability: 'audio',
      supportsTranscription: true
    }
  ]);
});

afterAll(async () => {
  await client?.close?.();
});

const base = {
  name: 'n',
  content: 'c',
  tags: [],
  displayOrder: 0,
  type: 'chat' as const,
  needsReference: false
};

describe('what a prompt presets', () => {
  it('keeps its type, its reference and its model', async () => {
    const { id } = await createPrompt(
      'u1',
      { ...base, type: 'video', needsReference: true, modelId: 'director' },
      'private'
    );
    const row = await h.db.query.prompts.findFirst({
      where: eq(schema.prompts.id, id)
    });
    expect(row).toMatchObject({
      type: 'video',
      needsReference: true,
      modelId: 'director'
    });
  });

  /** The model, where one is preset, is one its type and reference call
   *  for: a chat model for a chat prompt, else one the entry of the media
   *  generation settings it is tried on can use. */
  it('takes only a model its type and reference call for', async () => {
    await expect(
      createPrompt('u1', { ...base, modelId: 'gone' }, 'private')
    ).rejects.toThrow('The model does not exist.');
    // Painter draws, but edits nothing; a chat prompt takes a chat model.
    await expect(
      createPrompt(
        'u1',
        { ...base, type: 'image', needsReference: true, modelId: 'painter' },
        'private'
      )
    ).rejects.toThrow('Painter cannot be this prompt’s model.');
    await expect(
      createPrompt('u1', { ...base, modelId: 'painter' }, 'private')
    ).rejects.toThrow('Painter cannot be this prompt’s model.');
    await expect(
      createPrompt('u1', { ...base, modelId: 'talker' }, 'private')
    ).resolves.toHaveProperty('id');
    // Ears transcribes: an audio prompt with a reference, not without.
    await expect(
      createPrompt(
        'u1',
        { ...base, type: 'audio', needsReference: true, modelId: 'ears' },
        'private'
      )
    ).resolves.toHaveProperty('id');
    await expect(
      createPrompt('u1', { ...base, type: 'audio', modelId: 'ears' }, 'private')
    ).rejects.toThrow('Ears cannot be this prompt’s model.');
  });

  it('may preset no model at all', async () => {
    await expect(
      createPrompt(
        'u1',
        { ...base, type: 'image', needsReference: true },
        'private'
      )
    ).resolves.toHaveProperty('id');
  });

  /** An edit is checked as the prompt it leaves: a new type is held to the
   *  model already preset. */
  it('checks an edit against what the prompt already presets', async () => {
    const { id } = await createPrompt(
      'u1',
      { ...base, type: 'image', modelId: 'painter' },
      'private'
    );
    await expect(updatePrompt('u1', { id, type: 'video' })).rejects.toThrow(
      'Painter cannot be this prompt’s model.'
    );
    await expect(
      updatePrompt('u1', { id, type: 'video', modelId: null })
    ).resolves.toBeUndefined();
  });

  /** A model deleted after the prompt named it does not hold up an edit
   *  that leaves the preset alone. */
  it('takes an edit that leaves the preset alone, whatever became of its model', async () => {
    await h.db.insert(schema.models).values({
      id: 'm-gone',
      name: 'Gone',
      modelId: 'gone-soon',
      capability: 'chat'
    });
    const { id } = await createPrompt(
      'u1',
      { ...base, modelId: 'gone-soon' },
      'private'
    );
    await h.db.delete(schema.models).where(eq(schema.models.id, 'm-gone'));
    await expect(
      updatePrompt('u1', { id, name: 'renamed' })
    ).resolves.toBeUndefined();
    await expect(updatePrompt('u1', { id, type: 'image' })).rejects.toThrow(
      'The model does not exist.'
    );
  });
});

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
