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

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

const { createTurn, listMessages, truncateAfter } = await import('./message');

let client: { close?: () => Promise<void> } | undefined;

const USER = 'user-1';
const OTHER = 'user-2';
const CHAT = 'chat-1';

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute));
const text = (value: string) => [{ type: 'text' as const, text: value }];

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  await h.db.delete(schema.artifacts);
  await h.db.delete(schema.messages);
  await h.db.delete(schema.chats);
  await h.db.delete(schema.users);

  await h.db.insert(schema.users).values([
    { id: USER, name: 'A', email: 'a@example.com' },
    { id: OTHER, name: 'B', email: 'b@example.com' }
  ]);
  await h.db
    .insert(schema.chats)
    .values({ id: CHAT, title: 'Chat', modelId: 'gpt-x', userId: USER });

  // Two turns: u1 → a1, u2 → a2.
  const row = (
    id: string,
    role: 'user' | 'assistant',
    minute: number,
    parentId?: string
  ) => ({
    id,
    role,
    parentId,
    parts: text(id),
    chatId: CHAT,
    userId: USER,
    createdAt: at(minute)
  });
  await h.db.insert(schema.messages).values([row('u1', 'user', 0)]);
  await h.db.insert(schema.messages).values([row('a1', 'assistant', 1, 'u1')]);
  await h.db.insert(schema.messages).values([row('u2', 'user', 2)]);
  await h.db.insert(schema.messages).values([row('a2', 'assistant', 3, 'u2')]);
  await h.db.insert(schema.artifacts).values({
    id: 'art-2',
    chatId: CHAT,
    messageId: 'a2',
    userId: USER,
    title: 'Later',
    type: 'text'
  });
});

/**
 * Regenerating the first reply drops every later message in the browser before
 * the request is sent. The model is then shown `listMessages`, so that has to
 * be the same conversation — it used to still hold the second turn, which the
 * model answered instead.
 */
describe('truncateAfter', () => {
  it('leaves exactly what the browser is showing', async () => {
    expect(await truncateAfter(USER, { chatId: CHAT, messageId: 'u1' })).toBe(
      true
    );

    const left = await listMessages(USER, CHAT);
    expect(left.map(message => message.id)).toEqual(['u1']);
    expect(await h.db.select().from(schema.artifacts)).toHaveLength(0);
  });

  it('cuts nothing after the last message, and says it was there', async () => {
    await h.db.delete(schema.artifacts);
    await h.db.delete(schema.messages).where(undefined);
    await h.db.insert(schema.messages).values({
      id: 'only',
      role: 'user',
      parts: text('only'),
      chatId: CHAT,
      userId: USER
    });

    expect(await truncateAfter(USER, { chatId: CHAT, messageId: 'only' })).toBe(
      true
    );
    expect(await listMessages(USER, CHAT)).toHaveLength(1);
  });

  /**
   * A reply is stamped by the app and the message it answers by the database.
   * When the two clocks disagree the reply can carry the earlier time — and
   * going by time alone it would be left standing when its message is
   * regenerated. It is matched by what it answers.
   */
  it('cuts a reply away even when its clock says it came first', async () => {
    await h.db.insert(schema.messages).values({
      id: 'a2-early',
      role: 'assistant',
      parentId: 'u2',
      parts: text('a2-early'),
      chatId: CHAT,
      userId: USER,
      // Before u2 (minute 2), which it answers.
      createdAt: new Date(Date.UTC(2026, 0, 1, 12, 1, 30))
    });

    await truncateAfter(USER, { chatId: CHAT, messageId: 'u2' });

    expect((await listMessages(USER, CHAT)).map(m => m.id)).toEqual([
      'u1',
      'a1',
      'u2'
    ]);
  });

  it('does not know a message that is new, or somebody else’s', async () => {
    expect(await truncateAfter(USER, { chatId: CHAT, messageId: 'new' })).toBe(
      false
    );
    expect(await truncateAfter(OTHER, { chatId: CHAT, messageId: 'u1' })).toBe(
      false
    );
    expect(await listMessages(USER, CHAT)).toHaveLength(4);
  });
});

/**
 * A stopped reply is stored by the generation that wrote it, a moment after it
 * stops. A regenerate pressed in that moment finds nothing to cut away, and
 * both replies end up stored — after which every turn sends the model two
 * answers in a row. Whichever is stored last takes the place.
 */
describe('createTurn', () => {
  it('leaves a user message with one reply', async () => {
    const reply = (id: string) => ({
      chatId: CHAT,
      artifacts: [],
      message: {
        id,
        parentId: 'u2',
        role: 'assistant' as const,
        parts: text(id),
        createdAt: at(5),
        updatedAt: at(5)
      }
    });

    await createTurn(USER, reply('a2-regenerated'));

    const left = await listMessages(USER, CHAT);
    expect(left.map(m => m.id)).toEqual(['u1', 'a1', 'u2', 'a2-regenerated']);
    // The reply it replaced took its artifact with it.
    expect(await h.db.select().from(schema.artifacts)).toHaveLength(0);
  });
});
