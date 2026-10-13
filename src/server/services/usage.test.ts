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
 * What everyone used over a window, against a real Postgres: the users who
 * called a model, and the Usage page's totals and days — over the window and
 * on each of its days.
 */

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

const { activeUsers, adminUsageStats } =
  await import('@/server/services/usage');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

const DAY = 24 * 60 * 60 * 1000;
/** A fixed window of ten days, from midnight UTC. */
const T0 = new Date('2026-09-01T00:00:00Z');
const day = (n: number, hours = 0) =>
  new Date(T0.getTime() + n * DAY + hours * 60 * 60 * 1000);
let seq = 0;

beforeEach(async () => {
  await h.db.delete(schema.usage);
  await h.db.delete(schema.users);
  await h.db
    .insert(schema.users)
    .values(
      ['a', 'b', 'idle'].map(id => ({ id, name: id, email: `${id}@x.test` }))
    );
});

async function use(
  userId: string,
  createdAt: Date,
  more: Partial<typeof schema.usage.$inferInsert> = {}
) {
  seq += 1;
  await h.db.insert(schema.usage).values({
    id: `u${seq}`,
    userId,
    capability: 'chat',
    createdAt,
    ...more
  });
}

describe('activeUsers', () => {
  it('counts a user active on several days once in the window, and on each day', async () => {
    await use('a', day(1));
    await use('a', day(1, 5));
    await use('a', day(3));
    await use('b', day(3));
    // Before the window.
    await use('idle', day(-1));

    const s = await activeUsers(day(0), day(10));
    expect(s.total).toBe(2);
    // Only the days with calls.
    expect(s.days.sort((a, b) => a.day - b.day)).toEqual([
      { day: 2, activeUsers: 1 },
      { day: 4, activeUsers: 2 }
    ]);
  });

  it('has no one where no one called a model', async () => {
    expect(await activeUsers(day(0), day(10))).toEqual({ total: 0, days: [] });
  });
});

describe('adminUsageStats', () => {
  /** Five calls over three days — chat on a provider, an image, speech
   *  spoken and heard — and one after the window. */
  async function calls() {
    await h.db.delete(schema.providers);
    await h.db.insert(schema.providers).values({
      id: 'p1',
      name: 'Primary',
      type: 'openai',
      apiKey: 'key'
    });
    const chat = { modelId: 'gpt', providerId: 'p1' };
    await use('a', day(1), {
      ...chat,
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 20,
      reasoningTokens: 5,
      spend: '3',
      cost: '1.5'
    });
    await use('b', day(1, 3), {
      ...chat,
      inputTokens: 40,
      outputTokens: 4,
      spend: '1',
      cost: '0.5'
    });
    await use('a', day(2), {
      modelId: 'img',
      capability: 'image',
      imageCount: 2,
      spend: '0.5',
      cost: '0.25'
    });
    await use('b', day(3), {
      modelId: 'tts',
      capability: 'audio',
      audioCharacters: 300,
      spend: '0.1',
      cost: '0.05'
    });
    await use('b', day(3, 1), {
      modelId: 'stt',
      capability: 'audio',
      audioSeconds: '3.5',
      spend: '0.2',
      cost: '0.1'
    });
    await use('a', day(10), { ...chat, spend: '9', cost: '9' });
  }

  it('gives the totals the cards show, and each day’s', async () => {
    await calls();
    const s = await adminUsageStats(day(0), day(10));
    const days = s.days.sort((a, b) => a.day - b.day);
    expect(days.map(d => d.day)).toEqual([2, 3, 4]);
    expect(days[0]).toMatchObject({ spend: 4, cost: 2, inputTokens: 140 });
    const total = (pick: (d: (typeof days)[number]) => number) =>
      days.reduce((n, d) => n + pick(d), 0);
    expect(total(d => d.spend)).toBeCloseTo(4.8);
    expect(total(d => d.cost)).toBeCloseTo(2.4);
    expect(total(d => d.inputTokens)).toBe(140);
    expect(total(d => d.outputTokens)).toBe(14);
    expect(total(d => d.cacheReadTokens)).toBe(20);
    expect(total(d => d.reasoningTokens)).toBe(5);
  });

  it('sums each day by model, provider and capability', async () => {
    await calls();
    const s = await adminUsageStats(day(0), day(10));
    const of = <T extends { day: number; key: string | null }>(
      rows: T[],
      day: number,
      key: string | null
    ) => rows.find(r => r.day === day && r.key === key);

    expect(of(s.models, 2, 'gpt')).toMatchObject({
      spend: 4,
      cost: 2,
      inputTokens: 140,
      outputTokens: 14
    });
    expect(of(s.models, 3, 'img')).toMatchObject({ images: 2, spend: 0.5 });
    expect(of(s.providers, 2, 'p1')).toMatchObject({
      name: 'Primary',
      cost: 2
    });
    // An image the row names no provider for.
    expect(of(s.providers, 3, null)).toMatchObject({ name: null, cost: 0.25 });
    expect(of(s.capabilities, 4, 'audio')).toMatchObject({ audios: 2 });
    expect(of(s.capabilities, 4, 'audio')?.spend).toBeCloseTo(0.3);
    expect(of(s.capabilities, 2, 'chat')).toMatchObject({ spend: 4 });
  });

  it('lists the install’s models and providers in the order they were added', async () => {
    await h.db.delete(schema.models);
    await h.db.delete(schema.providers);
    await h.db.insert(schema.providers).values([
      {
        id: 'p2',
        name: 'Later',
        type: 'xai',
        apiKey: 'key',
        createdAt: day(2)
      },
      {
        id: 'p1',
        name: 'First',
        type: 'openai',
        apiKey: 'key',
        createdAt: day(1)
      }
    ]);
    await h.db.insert(schema.models).values([
      {
        id: 'm2',
        name: 'B',
        modelId: 'grok-b',
        capability: 'chat',
        createdAt: day(2)
      },
      {
        id: 'm1',
        name: 'A',
        modelId: 'gpt-a',
        capability: 'image',
        createdAt: day(1)
      }
    ]);

    const s = await adminUsageStats(day(0), day(10));
    expect(s.catalog).toEqual({
      models: ['gpt-a', 'grok-b'],
      providers: [
        { id: 'p1', type: 'openai' },
        { id: 'p2', type: 'xai' }
      ]
    });
  });
});
