import { randomUUID } from 'node:crypto';
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

import { getUserUsageWindows } from '@/lib/queries';
import { assertQuota, getUserQuota, QuotaExceededError } from '@/lib/quota';
import {
  recordAudioUsage,
  recordChatUsage,
  recordImageUsage,
  recordVideoUsage
} from '@/lib/usage';
import * as schema from '@/server/db/schema';

import { makeTestDb } from '../test/pg';

// Point the app's db at an in-process Postgres (PGlite) with real migrations.
// getUserUsageWindows / getUserResolvedQuota / assertQuota all import this.
const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/server/db', () => ({
  get db() {
    return h.db;
  }
}));

let client: { close?: () => Promise<void> } | undefined;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client as never;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  // FK order: usage → pricing → model → provider; quotas/users last.
  await h.db.delete(schema.usage);
  await h.db.delete(schema.modelPricings);
  await h.db.delete(schema.models);
  await h.db.delete(schema.providers);
  await h.db.delete(schema.users);
  await h.db.delete(schema.quotas);
  await h.db.insert(schema.users).values({ id: 'u1', email: 'u1@test.com' });
  await h.db
    .insert(schema.providers)
    .values({ id: 'prov1', name: 'Test', type: 'openai', apiKey: 'sk-test' });
});

/** Seed a model + its pricing row so resolveModelByKey can find them. */
async function seedModel(
  capability: 'chat' | 'image' | 'video' | 'audio',
  modelId: string,
  pricing: Record<string, string>
) {
  await h.db.insert(schema.models).values({
    id: randomUUID(),
    name: modelId,
    modelId,
    providerId: 'prov1',
    capability
  });
  await h.db
    .insert(schema.modelPricings)
    .values({ id: randomUUID(), modelId, ...pricing });
}

/** Read back the single usage row recorded for u1 in a test. */
async function readUsageRow() {
  const rows = await h.db.select().from(schema.usage);
  return rows[0];
}

/** Insert a chat usage row at a specific instant with a given cost. */
async function addUsage(createdAt: Date, cost: string) {
  await h.db.insert(schema.usage).values({
    id: randomUUID(),
    userId: 'u1',
    capability: 'chat',
    cost,
    createdAt
  });
}

describe('getUserUsageWindows (real Postgres, timestamptz)', () => {
  it('counts a row created right now inside the 5h window (timezone regression)', async () => {
    // The original bug: a fresh row fell OUTSIDE the 5h window due to a naive
    // timestamp / TZ skew. With timestamptz it must be counted.
    await addUsage(new Date(), '1.5');

    const w = await getUserUsageWindows('u1');
    expect(w.fiveHour.used).toBeCloseTo(1.5, 10);
    expect(w.sevenDay.used).toBeCloseTo(1.5, 10);
  });

  it('5h window excludes rows older than 5h; 7d still includes them', async () => {
    await addUsage(new Date(Date.now() - 6 * HOUR), '2'); // outside 5h, inside 7d
    await addUsage(new Date(Date.now() - 1 * HOUR), '3'); // inside both

    const w = await getUserUsageWindows('u1');
    expect(w.fiveHour.used).toBeCloseTo(3, 10);
    expect(w.sevenDay.used).toBeCloseTo(5, 10);
  });

  it('7d window excludes rows older than 7 days', async () => {
    await addUsage(new Date(Date.now() - 8 * DAY), '10'); // outside 7d
    await addUsage(new Date(), '1');

    const w = await getUserUsageWindows('u1');
    expect(w.sevenDay.used).toBeCloseTo(1, 10);
    expect(w.fiveHour.used).toBeCloseTo(1, 10);
  });

  it('resetAt = oldest in-window row + window size', async () => {
    const t = new Date(Date.now() - 1 * HOUR);
    await addUsage(t, '1');

    const w = await getUserUsageWindows('u1');
    expect(w.fiveHour.resetAt?.getTime()).toBeCloseTo(
      t.getTime() + 5 * HOUR,
      -2
    );
    expect(w.sevenDay.resetAt?.getTime()).toBeCloseTo(
      t.getTime() + 7 * DAY,
      -2
    );
  });

  it('preserves full numeric precision of cost (numeric(20,10))', async () => {
    await addUsage(new Date(), '0.0000000001'); // 1e-10
    const w = await getUserUsageWindows('u1');
    expect(w.fiveHour.used).toBeCloseTo(1e-10, 15);
  });

  it('returns zeros and null resets when the user has no usage', async () => {
    const w = await getUserUsageWindows('u1');
    expect(w.fiveHour.used).toBe(0);
    expect(w.sevenDay.used).toBe(0);
    expect(w.fiveHour.resetAt).toBeNull();
    expect(w.sevenDay.resetAt).toBeNull();
  });
});

describe('quota enforcement end-to-end (real Postgres)', () => {
  async function setQuota(fiveHour: string | null, sevenDay: string | null) {
    const id = randomUUID();
    await h.db.insert(schema.quotas).values({
      id,
      name: 'Pro',
      fiveHour,
      sevenDay,
      isUnlimited: false
    });
    await h.db
      .update(schema.users)
      .set({ quotaId: id })
      .where(eq(schema.users.id, 'u1'));
  }

  it('throws QuotaExceededError once 5h usage reaches the cap', async () => {
    await setQuota('10', '100');
    await addUsage(new Date(), '10'); // hits the 5h cap

    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('passes when usage is below caps', async () => {
    await setQuota('10', '100');
    await addUsage(new Date(), '4');

    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });

  it('getUserQuota exposes remaining percent + reset, never dollars', async () => {
    await setQuota('10', '100');
    await addUsage(new Date(), '2.5'); // 25% of 5h used → 75% remaining

    const q = await getUserQuota('u1');
    expect(q.fiveHour?.remainingPct).toBe(75);
    expect(q.fiveHour?.resetAt).toBeInstanceOf(Date);
    // No dollar amounts leak.
    expect(JSON.stringify(q)).not.toContain('"used"');
    expect(JSON.stringify(q)).not.toMatch(/"(cap|fiveHour|sevenDay)":\s*\d/);
  });
});

describe('usage recording write round-trip (real Postgres)', () => {
  const base = { userId: 'u1', messageId: randomUUID() };

  it('chat: writes computed cost + token snapshot', async () => {
    await seedModel('chat', 'gpt-test', { input: '3', output: '15' });
    await recordChatUsage({
      ...base,
      modelId: 'gpt-test',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    });
    const row = await readUsageRow();
    expect(Number(row.cost)).toBeCloseTo(18, 10); // 3 + 15
    expect(row.inputTokens).toBe(1_000_000);
    expect(row.inputPrice).toBe('3.0000000000'); // snapshot persisted
  });

  it('image (token-billed): bills input + output tokens', async () => {
    await seedModel('image', 'gpt-image-1', { input: '5', output: '40' });
    await recordImageUsage({
      ...base,
      modelId: 'gpt-image-1',
      imageCount: 1,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000
    });
    const row = await readUsageRow();
    expect(Number(row.cost)).toBeCloseTo(45, 10); // 5 + 40
  });

  it('image (per-image): bills imageCount × rate', async () => {
    await seedModel('image', 'dall-e-3', { image: '0.04' });
    await recordImageUsage({
      ...base,
      modelId: 'dall-e-3',
      imageCount: 3
    });
    const row = await readUsageRow();
    expect(Number(row.cost)).toBeCloseTo(0.12, 10); // 3 × 0.04
  });

  it('video (per-second): bills seconds × rate', async () => {
    await seedModel('video', 'veo-test', { videoSeconds: '0.1' });
    await recordVideoUsage({
      ...base,
      modelId: 'veo-test',
      videoCount: 1,
      videoSeconds: 10
    });
    const row = await readUsageRow();
    expect(Number(row.cost)).toBeCloseTo(1, 10); // 10 × 0.1
  });

  it('audio (per-character): bills characters × rate per 1M', async () => {
    await seedModel('audio', 'tts-test', { audioCharacters: '15' });
    await recordAudioUsage({
      ...base,
      modelId: 'tts-test',
      audioCharacters: 500_000
    });
    const row = await readUsageRow();
    expect(Number(row.cost)).toBeCloseTo(7.5, 10); // 500k × 15 / 1M
  });
});
