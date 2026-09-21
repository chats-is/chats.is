import { makeTestDb } from '@/test-utils/pg';
import { eq } from 'drizzle-orm';
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

const {
  beginGeneration,
  endGeneration,
  generationState,
  getStreamId,
  isGenerating,
  MAX_CONCURRENT_GENERATIONS,
  stopGeneration
} = await import('./chat');

let client: { close?: () => Promise<void> } | undefined;

const USER = 'user-1';
const OTHER = 'user-2';
const chatIds = Array.from(
  { length: MAX_CONCURRENT_GENERATIONS + 2 },
  (_, i) => `chat-${i}`
);

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  await h.db.delete(schema.chats);
  await h.db.delete(schema.users);
  await h.db.insert(schema.users).values([
    { id: USER, name: 'A', email: 'a@example.com' },
    { id: OTHER, name: 'B', email: 'b@example.com' }
  ]);
  await h.db
    .insert(schema.chats)
    .values([
      ...chatIds.map(id => ({ id, title: id, modelId: 'gpt-x', userId: USER })),
      { id: 'theirs', title: 'theirs', modelId: 'gpt-x', userId: OTHER }
    ]);
});

const claim = (chatId: string, userId = USER) =>
  beginGeneration(userId, { chatId, streamId: `stream-${chatId}` });

describe('generation claims', () => {
  /**
   * The quota is read when a turn starts and charged when it ends, so a burst
   * of turns all read the same number. What bounds the overspend is how many
   * of them are let through — counted under a lock, or the burst would count
   * itself the same way it reads the quota.
   */
  // What this proves is the counting. It cannot prove the lock: the test
  // database is a single connection, so these run one after another whether
  // or not anything makes them. Under real concurrency it is the advisory
  // lock in `beginGeneration` that keeps the count from being read twice.
  it('lets through only up to the limit, however many ask', async () => {
    const claimed = await Promise.all(chatIds.map(id => claim(id)));

    expect(claimed.filter(Boolean)).toHaveLength(MAX_CONCURRENT_GENERATIONS);
  });

  it('counts a person’s own generations, and frees a place when one ends', async () => {
    for (const id of chatIds.slice(0, MAX_CONCURRENT_GENERATIONS)) {
      expect(await claim(id)).toBe(true);
    }
    const next = chatIds[MAX_CONCURRENT_GENERATIONS];

    expect(await claim(next)).toBe(false);
    expect(await claim('theirs', OTHER)).toBe(true);

    await endGeneration(chatIds[0], `stream-${chatIds[0]}`);
    expect(await claim(next)).toBe(true);
  });

  it('does not count a claim nothing ever let go of', async () => {
    for (const id of chatIds.slice(0, MAX_CONCURRENT_GENERATIONS)) {
      await claim(id);
    }
    // A function killed mid-turn: claimed ten minutes ago, never released.
    await h.db
      .update(schema.chats)
      .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(schema.chats.id, chatIds[0]));

    expect(await claim(chatIds[MAX_CONCURRENT_GENERATIONS])).toBe(true);
  });

  it('is withdrawn by Stop — by the owner, and nobody else', async () => {
    await claim(chatIds[0]);

    await stopGeneration(OTHER, chatIds[0]);
    expect(await isGenerating(chatIds[0], `stream-${chatIds[0]}`)).toBe(true);

    await stopGeneration(USER, chatIds[0]);
    expect(await isGenerating(chatIds[0], `stream-${chatIds[0]}`)).toBe(false);
    expect(await generationState(chatIds[0], `stream-${chatIds[0]}`)).toBe(
      'stopped'
    );
    expect(await getStreamId(USER, chatIds[0])).toBeNull();
  });

  it('passes to a newer turn in the same chat, and the older one can tell', async () => {
    await beginGeneration(USER, { chatId: chatIds[0], streamId: 'older' });
    await beginGeneration(USER, { chatId: chatIds[0], streamId: 'newer' });

    expect(await isGenerating(chatIds[0], 'older')).toBe(false);

    // The two ways a claim is lost are told apart, because only one of them
    // leaves a reply worth storing.
    expect(await generationState(chatIds[0], 'older')).toBe('superseded');
    expect(await generationState(chatIds[0], 'newer')).toBe('held');

    // The older one finishing must not release the newer one's claim.
    await endGeneration(chatIds[0], 'older');
    expect(await isGenerating(chatIds[0], 'newer')).toBe(true);
  });
});
