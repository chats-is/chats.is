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
 * The library feed is two queries over two very different shapes — artifact
 * columns, and media buried in a message's `parts` JSON — merged in
 * TypeScript. Search has to reach both, so it runs against a real Postgres:
 * the jsonpath that picks a media card's title out of that JSON is the part
 * no amount of mocking would tell the truth about.
 */
const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

const { listLibrary } = await import('./library');

let client: { close?: () => Promise<void> } | undefined;

const USER = 'user-1';
const CHAT = 'chat-1';

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  // FK order: artifacts → messages → chats → users.
  await h.db.delete(schema.artifacts);
  await h.db.delete(schema.messages);
  await h.db.delete(schema.chats);
  await h.db.delete(schema.users);

  await h.db.insert(schema.users).values({
    id: USER,
    name: 'Test',
    email: 'test@example.com'
  });
  await h.db.insert(schema.chats).values({
    id: CHAT,
    title: 'Chat',
    modelId: 'gpt-4',
    userId: USER
  });
});

/** An assistant message that produced one image, with `said` as its reply. */
async function seedMedia(id: string, said: string, filename: string) {
  await h.db.insert(schema.messages).values({
    id,
    role: 'assistant',
    userId: USER,
    chatId: CHAT,
    parts: [
      { type: 'text', text: said },
      {
        type: 'tool-generate_image',
        output: {
          status: 'done',
          url: `https://blob.example/${id}-sunset.png`,
          mediaType: 'image/png',
          filename
        }
      }
    ]
  });
}

async function seedArtifact(id: string, title: string, content: string) {
  await h.db.insert(schema.messages).values({
    id: `${id}-msg`,
    role: 'assistant',
    userId: USER,
    chatId: CHAT,
    parts: [{ type: 'text', text: 'here you go' }]
  });
  await h.db.insert(schema.artifacts).values({
    id,
    chatId: CHAT,
    messageId: `${id}-msg`,
    userId: USER,
    title,
    type: 'code',
    content
  });
}

const search = async (term?: string) =>
  (await listLibrary(USER, { limit: 24, search: term })).items;

describe('listLibrary search', () => {
  it('returns everything when no term is given', async () => {
    await seedMedia('m1', 'a red barn at dusk', 'barn.png');
    await seedArtifact('a1', 'Sorting hat', 'function quicksort() {}');

    expect(await search()).toHaveLength(2);
    expect(await search('   ')).toHaveLength(2);
  });

  it('matches what a media card shows: the words the message said', async () => {
    await seedMedia('m1', 'a red barn at dusk', 'barn.png');
    await seedMedia('m2', 'a blue whale', 'whale.png');

    const found = await search('red barn');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      type: 'media',
      title: 'a red barn at dusk'
    });
  });

  it("matches a media file's own name", async () => {
    await seedMedia('m1', 'a red barn at dusk', 'barn.png');

    expect(await search('barn.png')).toHaveLength(1);
  });

  it('does not match the url or the tool name, which no card shows', async () => {
    await seedMedia('m1', 'a red barn at dusk', 'barn.png');

    // The url contains "sunset" and the part type contains "generate_image".
    expect(await search('sunset')).toHaveLength(0);
    expect(await search('generate_image')).toHaveLength(0);
    expect(await search('blob.example')).toHaveLength(0);
  });

  it("matches an artifact's title and its body", async () => {
    await seedArtifact('a1', 'Sorting hat', 'function quicksort() {}');

    expect(await search('sorting')).toHaveLength(1);
    expect(await search('quicksort')).toHaveLength(1);
    expect(await search('mergesort')).toHaveLength(0);
  });

  it('is case-insensitive and reaches both sources at once', async () => {
    await seedMedia('m1', 'a SUNFLOWER field', 'flower.png');
    await seedArtifact('a1', 'Sunflower notes', 'nothing here');

    const found = await search('sunflower');
    expect(found).toHaveLength(2);
    expect(found.map(item => item.type).sort()).toEqual(['artifact', 'media']);
  });
});
