import { randomUUID } from 'node:crypto';
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

import { pricingUpsertSchema } from '@/types/pricing';
import { normalizeChatUsage } from '@/lib/chat-usage';
import * as schema from '@/db/schema';
import {
  PricingMissingError,
  requirePricing,
  upsertPricing
} from '@/server/services/pricing';
import {
  assertModelAccess,
  assertQuota,
  getUserUsageWindows,
  ModelAccessDeniedError,
  QuotaExceededError,
  QuotaMissingError
} from '@/server/services/quota';
import {
  recordAudioUsage,
  recordChatUsage,
  recordImageUsage,
  recordTranscriptionUsage,
  recordVideoUsage
} from '@/server/services/usage';

/**
 * How billing behaves today, one behaviour per test, each named for what it
 * shows. Not a judgement of whether the behaviour is right — a record of what
 * it is, run against the real services and a real Postgres, so it can be read
 * and checked rather than taken on trust.
 */

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

let client: { close?: () => Promise<void> } | undefined;
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  await h.db.delete(schema.usage);
  await h.db.delete(schema.modelPricings);
  await h.db.delete(schema.models);
  await h.db.delete(schema.providers);
  await h.db.delete(schema.users);
  await h.db.delete(schema.quotas);
  await h.db
    .insert(schema.users)
    .values({ id: 'u1', name: 'u1', email: 'u1@test.com' });
  await h.db
    .insert(schema.providers)
    .values({ id: 'prov1', name: 'Test', type: 'openai', apiKey: 'sk-test' });
});

/** A model with no price yet; returns its row id. */
async function addModel(
  capability: 'chat' | 'image' | 'video' | 'audio',
  modelId: string,
  extra: Record<string, unknown> = {}
) {
  const id = randomUUID();
  await h.db
    .insert(schema.models)
    .values({ id, name: modelId, modelId, capability, ...extra });
  return id;
}

/** Save a price the way the console does: through the form's schema. */
async function savePrice(modelDbId: string, form: Record<string, unknown>) {
  await upsertPricing(pricingUpsertSchema.parse({ modelDbId, ...form }));
}

async function priceRow(modelId: string) {
  const [row] = await h.db
    .select()
    .from(schema.modelPricings)
    .where(eq(schema.modelPricings.modelId, modelId));
  return row;
}

async function usageRows(): Promise<Array<typeof schema.usage.$inferSelect>> {
  return h.db.select().from(schema.usage).orderBy(schema.usage.createdAt);
}

async function giveQuota(
  fiveHour: string | null,
  sevenDay: string | null,
  extra: Record<string, unknown> = {}
) {
  const id = randomUUID();
  await h.db.insert(schema.quotas).values({
    id,
    name: `q-${id}`,
    fiveHour,
    sevenDay,
    isUnlimited: false,
    ...extra
  });
  await h.db
    .update(schema.users)
    .set({ quotaId: id })
    .where(eq(schema.users.id, 'u1'));
}

async function spent(cost: string, at = new Date(), capability = 'chat') {
  await h.db.insert(schema.usage).values({
    id: randomUUID(),
    userId: 'u1',
    capability: capability as 'chat',
    cost,
    createdAt: at
  });
}

const call = { userId: 'u1', messageId: 'm1', providerId: 'prov1' };

describe('setting prices', () => {
  it('a chat model’s cache read and cache write left blank are stored as 0', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, {
      input: '3',
      output: '15',
      cacheRead: '',
      cacheWrite: ''
    });
    const row = await priceRow('c1');
    expect(Number(row.cacheRead)).toBe(0);
    expect(Number(row.cacheWrite)).toBe(0);
  });

  it('a reasoning rate left blank is stored empty and bills at the output rate', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '1', output: '10', reasoning: '' });
    expect((await priceRow('c1')).reasoning).toBeNull();

    await recordChatUsage({
      ...call,
      modelId: 'c1',
      usage: { reasoningTokens: 1_000_000 }
    });
    const [row] = await usageRows();
    expect(Number(row.cost)).toBeCloseTo(10, 10);
  });

  it('a price may be 0: the model is usable and the cost is recorded as 0', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '0', output: '0' });
    await expect(requirePricing('c1', 'chat', 'c1')).resolves.toBeTruthy();

    await recordChatUsage({
      ...call,
      modelId: 'c1',
      usage: { inputTokens: 1000, outputTokens: 1000 }
    });
    expect(Number((await usageRows())[0].cost)).toBe(0);
  });

  it('a model with no price is refused before the call', async () => {
    await addModel('chat', 'c1');
    await expect(requirePricing('c1', 'chat', 'c1')).rejects.toBeInstanceOf(
      PricingMissingError
    );
  });

  it('saving a chat model without an input or output rate is refused', async () => {
    const id = await addModel('chat', 'c1');
    await expect(savePrice(id, { input: '3' })).rejects.toThrow(/Output/);
    await expect(savePrice(id, { output: '15' })).rejects.toThrow(/Input/);
  });

  it('an image model cannot have both a per-image and a per-token rate', async () => {
    const id = await addModel('image', 'i1');
    await expect(
      savePrice(id, { image: '0.04', input: '5', output: '40' })
    ).rejects.toThrow(/either Per image OR token-based/);
  });

  it('a speech model needs a per-1M-characters rate, a transcription model a per-second rate', async () => {
    const tts = await addModel('audio', 'tts1');
    await expect(savePrice(tts, { audioSeconds: '0.01' })).rejects.toThrow(
      /Per 1M characters/
    );
    const stt = await addModel('audio', 'stt1', {
      supportsTranscription: true
    });
    await expect(savePrice(stt, { audioCharacters: '15' })).rejects.toThrow(
      /Per second/
    );
  });
});

describe('billing', () => {
  it('chat: cached tokens bill at the cache rate, not the input rate', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '10', output: '0', cacheRead: '1' });

    // What the SDK reports: 1,000 input tokens, 800 of them served from cache.
    const usage = normalizeChatUsage({
      inputTokens: 1000,
      inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 800 }
    });
    await recordChatUsage({ ...call, modelId: 'c1', usage });

    const [row] = await usageRows();
    expect(row.inputTokens).toBe(200);
    expect(row.cacheReadTokens).toBe(800);
    // 200 × $10/1M + 800 × $1/1M
    expect(Number(row.cost)).toBeCloseTo(0.0028, 10);
  });

  it('chat: reasoning tokens bill on their own, not again as output', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '0', output: '10', reasoning: '20' });

    const usage = normalizeChatUsage({
      outputTokens: 1000,
      outputTokenDetails: { textTokens: 300, reasoningTokens: 700 }
    });
    await recordChatUsage({ ...call, modelId: 'c1', usage });

    const [row] = await usageRows();
    expect(row.outputTokens).toBe(300);
    expect(row.reasoningTokens).toBe(700);
    // 300 × $10/1M + 700 × $20/1M
    expect(Number(row.cost)).toBeCloseTo(0.017, 10);
  });

  it('chat: each web search is billed at the search rate, on top of the tokens', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '1', output: '0', webSearch: '0.01' });

    // A step that searched twice: 2 × $0.01 on top of 1M × $1/1M.
    await recordChatUsage({
      ...call,
      modelId: 'c1',
      usage: { inputTokens: 1_000_000, webSearches: 2 }
    });

    const [row] = await usageRows();
    expect(row.webSearches).toBe(2);
    expect(row.webSearchPrice).toBe('0.0100000000');
    expect(Number(row.cost)).toBeCloseTo(1.02, 10);
  });

  it('chat: a search rate left blank bills searches at 0', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '0', output: '0' });

    await recordChatUsage({
      ...call,
      modelId: 'c1',
      usage: { webSearches: 3 }
    });

    const [row] = await usageRows();
    expect(row.webSearches).toBe(3);
    expect(row.webSearchPrice).toBeNull();
    expect(Number(row.cost)).toBe(0);
  });

  it('bills at the price at the time of the call; a later change leaves the record alone', async () => {
    const id = await addModel('chat', 'c1');
    await savePrice(id, { input: '1', output: '0' });
    await recordChatUsage({
      ...call,
      modelId: 'c1',
      usage: { inputTokens: 1_000_000 }
    });

    await savePrice(id, { input: '5', output: '0' });
    await recordChatUsage({
      ...call,
      modelId: 'c1',
      usage: { inputTokens: 1_000_000 }
    });

    // Told apart by price rather than by order: the two can land in the
    // same instant.
    const rows = await usageRows();
    const before = rows.find(r => Number(r.inputPrice) === 1);
    const after = rows.find(r => Number(r.inputPrice) === 5);
    expect(rows).toHaveLength(2);
    expect(Number(before?.cost)).toBeCloseTo(1, 10);
    expect(Number(after?.cost)).toBeCloseTo(5, 10);
  });

  it('image: a per-image rate bills on the count, ignoring tokens', async () => {
    const id = await addModel('image', 'i1');
    await savePrice(id, { image: '0.04' });
    await recordImageUsage({
      ...call,
      modelId: 'i1',
      imageCount: 1,
      inputTokens: 5000,
      outputTokens: 5000
    });
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.04, 10);
  });

  it('image: a per-token rate bills on input and output tokens', async () => {
    const id = await addModel('image', 'i1');
    await savePrice(id, { input: '5', output: '40' });
    await recordImageUsage({
      ...call,
      modelId: 'i1',
      imageCount: 1,
      inputTokens: 1000,
      outputTokens: 4000
    });
    // 1,000 × $5/1M + 4,000 × $40/1M
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.165, 10);
  });

  it('video: a per-second rate bills on the seconds', async () => {
    const id = await addModel('video', 'v1');
    await savePrice(id, { videoSeconds: '0.1' });
    await recordVideoUsage({
      ...call,
      modelId: 'v1',
      videoCount: 1,
      videoSeconds: 8
    });
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.8, 10);
  });

  it('video: a per-video rate bills on the count, ignoring seconds', async () => {
    const id = await addModel('video', 'v1');
    await savePrice(id, { video: '0.5' });
    await recordVideoUsage({
      ...call,
      modelId: 'v1',
      videoCount: 1,
      videoSeconds: 8
    });
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.5, 10);
  });

  it('speech: bills characters × the per-1M-characters rate', async () => {
    const id = await addModel('audio', 'tts1');
    await savePrice(id, { audioCharacters: '15' });
    await recordAudioUsage({ ...call, modelId: 'tts1', audioCharacters: 86 });
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.00129, 10);
  });

  it('transcription: bills seconds × the per-second rate', async () => {
    const id = await addModel('audio', 'stt1', {
      supportsTranscription: true
    });
    await savePrice(id, { audioSeconds: '0.0001' });
    await recordTranscriptionUsage({
      ...call,
      modelId: 'stt1',
      audioSeconds: 60
    });
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.006, 10);
  });
});

describe('quota', () => {
  it('a user with no quota is refused before the call', async () => {
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaMissingError);
  });

  it('an unlimited quota does not check usage', async () => {
    await giveQuota(null, null, { isUnlimited: true });
    await spent('1000');
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });

  it('usage below the limit is let through, whatever this call will cost', async () => {
    await giveQuota('3', '20');
    await spent('2.99');
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });

  it('usage at the limit is refused', async () => {
    await giveQuota('3', '20');
    await spent('3');
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('a cost past the limit is recorded as usual, and later calls are refused until it leaves the 5-hour window', async () => {
    await giveQuota('3', '20');
    // Let through at $2.99, then a call that cost $5.
    await spent('2.99', new Date(Date.now() - 2 * HOUR));
    await spent('5', new Date(Date.now() - 2 * HOUR));
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);

    // Five hours later both have left the 5-hour window; the week still
    // counts them ($7.99 of $20), which is under its cap.
    await h.db.update(schema.usage).set({
      createdAt: new Date(Date.now() - 6 * HOUR)
    });
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });

  it('calls that start together are checked before any is recorded, so none sees the others’ cost: all pass, and the sum exceeds the limit', async () => {
    await giveQuota('3', '20');
    await spent('2.99');

    // Three calls start together; each is checked before any is charged.
    const checks = await Promise.allSettled([
      assertQuota('u1'),
      assertQuota('u1'),
      assertQuota('u1')
    ]);
    expect(checks.every(c => c.status === 'fulfilled')).toBe(true);

    // Each is charged when it finishes, $1 apiece.
    await spent('1');
    await spent('1');
    await spent('1');

    expect((await getUserUsageWindows('u1')).fiveHour.used).toBeCloseTo(
      5.99,
      10
    );
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('the 5-hour and weekly limits are checked separately; reaching either refuses', async () => {
    await giveQuota('3', '20');
    // Under the 5-hour cap now, but the week has reached its own.
    await spent('20', new Date(Date.now() - 24 * HOUR));
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('chat, image, video, speech and transcription all count against one quota', async () => {
    await giveQuota('3', '20');
    await spent('1', new Date(), 'image');
    await spent('1', new Date(), 'video');
    await spent('1', new Date(), 'audio');
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('a quota that names its models refuses the others before the call; one that names none allows all', async () => {
    await giveQuota('3', '20', { allowedModelIds: ['c1'] });
    await expect(assertModelAccess('u1', 'c1', 'c1')).resolves.toBeUndefined();
    await expect(assertModelAccess('u1', 'c2', 'c2')).rejects.toBeInstanceOf(
      ModelAccessDeniedError
    );

    await giveQuota('3', '20');
    await expect(assertModelAccess('u1', 'c2', 'c2')).resolves.toBeUndefined();
  });
});
