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

const { activeUsers, adminUsageLog, adminUsageStats, recordChatUsage } =
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

describe('recordChatUsage', () => {
  it('writes the row under the id the call carried, with the provider’s ids', async () => {
    await recordChatUsage({
      id: 'usage-sent',
      userId: 'a',
      modelId: 'm',
      providerId: 'p',
      providerRequests: [
        { responseId: 'resp_1', requestId: 'req_1' },
        { responseId: 'resp_2' }
      ],
      usage: { inputTokens: 10, outputTokens: 5 }
    });
    const rows = await h.db.select().from(schema.usage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'usage-sent',
      providerRequests: [
        { responseId: 'resp_1', requestId: 'req_1' },
        { responseId: 'resp_2' }
      ]
    });
  });

  it('makes an id, and keeps no ids, for a call that carried none', async () => {
    await recordChatUsage({
      userId: 'a',
      modelId: 'm',
      providerId: 'p',
      providerRequests: [],
      usage: { inputTokens: 10, outputTokens: 5 }
    });
    const [row] = await h.db.select().from(schema.usage);
    expect(row.id).toBeTruthy();
    expect(row.providerRequests).toBeNull();
  });
});

describe('adminUsageLog search', () => {
  const log = (
    userQuery: string,
    more: { from?: Date; modelId?: string } = {}
  ) => adminUsageLog({ userQuery, page: 1, pageSize: 50, ...more });
  const ids = async (...args: Parameters<typeof log>) =>
    (await log(...args)).rows.map(r => r.id);

  beforeEach(async () => {
    await h.db
      .insert(schema.users)
      .values({ id: 'u-42', name: 'Zed', email: 'zed@x.test' });
    await use('a', day(1), {
      id: 'row-1',
      modelId: 'm',
      providerRequests: [
        { requestId: 'req_1', responseId: 'resp_1' },
        { requestId: 'req_2', responseId: 'resp_2' }
      ]
    });
    await use('u-42', day(1), { id: 'zed-early' });
    await use('u-42', day(6), { id: 'zed-late' });
  });

  it('finds a record by its own id, or by a request or response id of any of its calls', async () => {
    for (const id of ['row-1', 'req_1', 'resp_2', '  req_2  ']) {
      expect(await ids(id)).toEqual(['row-1']);
    }
  });

  it('finds a record by id only within the window and the other filters', async () => {
    expect(await ids('resp_1', { from: day(5) })).toEqual([]);
    expect(await ids('resp_1', { modelId: 'other' })).toEqual([]);
    expect(await ids('resp_1', { from: day(1), modelId: 'm' })).toEqual([
      'row-1'
    ]);
  });

  it('finds a user by their id, within the window like any user search', async () => {
    expect(await ids('u-42')).toEqual(['zed-late', 'zed-early']);
    expect(await ids('u-42', { from: day(5) })).toEqual(['zed-late']);
  });

  it('still finds users by name or address in part', async () => {
    expect(await ids('ze')).toEqual(['zed-late', 'zed-early']);
    expect(await ids('zed@x')).toEqual(['zed-late', 'zed-early']);
  });

  it('finds nothing for an id no record has, nor for part of one', async () => {
    expect((await log('req_9')).total).toBe(0);
    expect((await log('req_')).total).toBe(0);
    expect((await log('u-4')).total).toBe(0);
  });
});
