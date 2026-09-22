import { makeTestDb } from '@/test-utils/pg';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({
  db: undefined as any,
  del: vi.fn(async (_urls: string[]) => {})
}));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@vercel/blob', () => ({ del: h.del }));

const { deleteChat } = await import('./chat');
const { truncateAfter } = await import('./message');
const { carriesOnlyOwnFiles, isOwnBlobUrl } = await import('./blob');

let client: { close?: () => Promise<void> } | undefined;

const USER = 'user-1';
const STORE = 'https://store.public.blob.vercel-storage.com';
const mine = (name: string) => `${STORE}/uploads/attachments/${USER}/${name}`;

const file = (url: string) => ({
  type: 'file' as const,
  mediaType: 'image/png',
  url
});
const generated = (url: string) =>
  ({
    type: 'tool-generate_image',
    toolCallId: 't',
    state: 'output-available',
    input: { prompt: 'p' },
    output: { status: 'success', url, mediaType: 'image/png' }
  }) as never;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  // The store the URLs below are in, named by the token as the app reads it —
  // so the test does not depend on what the shell happens to carry: with a
  // real token in the environment these files were another store's, and
  // nothing was removed.
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_store_secret');
  h.del.mockClear();
  await h.db.delete(schema.artifacts);
  await h.db.delete(schema.messages);
  await h.db.delete(schema.chats);
  await h.db.delete(schema.users);

  await h.db
    .insert(schema.users)
    .values({ id: USER, name: 'A', email: 'a@example.com' });
  await h.db.insert(schema.chats).values([
    { id: 'c1', title: 'one', modelId: 'gpt-x', userId: USER },
    { id: 'c2', title: 'two', modelId: 'gpt-x', userId: USER }
  ]);

  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute));
  await h.db.insert(schema.messages).values([
    {
      id: 'u1',
      role: 'user',
      chatId: 'c1',
      userId: USER,
      createdAt: at(0),
      parts: [file(mine('attached.png')), file(mine('shared.png'))]
    }
  ]);
  await h.db.insert(schema.messages).values([
    {
      id: 'a1',
      role: 'assistant',
      parentId: 'u1',
      chatId: 'c1',
      userId: USER,
      createdAt: at(1),
      parts: [
        generated(mine('generated.png')),
        // Somebody else's address in this user's row: never theirs to delete.
        file(`${STORE}/uploads/attachments/user-2/theirs.png`),
        file('https://elsewhere.test/x.png')
      ]
    },
    // The other chat names one of the same files.
    {
      id: 'u2',
      role: 'user',
      chatId: 'c2',
      userId: USER,
      createdAt: at(2),
      parts: [file(mine('shared.png'))]
    }
  ]);
  await h.db.insert(schema.artifacts).values({
    id: 'art',
    chatId: 'c1',
    messageId: 'a1',
    userId: USER,
    title: 'File',
    type: 'file',
    fileUrl: mine('artifact.pdf')
  });
});

const deleted = () => (h.del.mock.calls[0]?.[0] ?? []).slice().sort();

describe('files follow their rows', () => {
  it('removes a deleted chat’s files — its own, and only the ones nothing else names', async () => {
    await deleteChat(USER, 'c1');

    expect(deleted()).toEqual(
      [mine('artifact.pdf'), mine('attached.png'), mine('generated.png')].sort()
    );
  });

  it('removes what a regenerate cuts away, and keeps what is left standing', async () => {
    await truncateAfter(USER, { chatId: 'c1', messageId: 'u1' });

    expect(deleted()).toEqual(
      [mine('artifact.pdf'), mine('generated.png')].sort()
    );
    expect(
      await h.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, 'u1'))
    ).toHaveLength(1);
  });

  it('does not fail the deletion when storage does', async () => {
    h.del.mockRejectedValueOnce(new Error('storage is down'));

    await expect(deleteChat(USER, 'c1')).resolves.toBeUndefined();
    // It was really asked to — a cleanup that silently did nothing would
    // leave the same rows behind and pass just as well.
    expect(h.del).toHaveBeenCalledOnce();
    expect(await h.db.select().from(schema.chats)).toHaveLength(1);
  });
});

describe('isOwnBlobUrl', () => {
  it('knows this install’s store from the token it writes with', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_AbC123_secretpart');

    expect(
      isOwnBlobUrl(
        'https://abc123.public.blob.vercel-storage.com/uploads/a.png'
      )
    ).toBe(true);
    // Somebody else's store: a blob host, which is all the shared check asks.
    expect(
      isOwnBlobUrl('https://other.public.blob.vercel-storage.com/uploads/a.png')
    ).toBe(false);
    expect(isOwnBlobUrl('https://evil.test/a.png')).toBe(false);

    // What a newly sent message is held to: text is free, files are ours.
    const ours = 'https://abc123.public.blob.vercel-storage.com/uploads/a.png';
    expect(
      carriesOnlyOwnFiles([
        { type: 'text' },
        { type: 'file', url: ours } as never
      ])
    ).toBe(true);
    for (const url of [
      'https://evil.test/x.png',
      'data:image/png;base64,AAAA',
      'https://other.public.blob.vercel-storage.com/x.png'
    ]) {
      expect(carriesOnlyOwnFiles([{ type: 'file', url } as never])).toBe(false);
    }

    vi.unstubAllEnvs();
  });
});
