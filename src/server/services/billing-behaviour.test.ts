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

async function usageRows() {
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

describe('价格设置', () => {
  it('聊天模型的缓存读、缓存写留空保存时，存为 0', async () => {
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

  it('推理价留空保存时为空，计费时按输出价计', async () => {
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

  it('价格可以设为 0：模型可以使用，费用记为 0', async () => {
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

  it('没有价格的模型，调用前被拒绝', async () => {
    await addModel('chat', 'c1');
    await expect(requirePricing('c1', 'chat', 'c1')).rejects.toBeInstanceOf(
      PricingMissingError
    );
  });

  it('聊天模型缺少输入价或输出价，调用前被拒绝', async () => {
    const id = await addModel('chat', 'c1');
    await expect(savePrice(id, { input: '3' })).rejects.toThrow(/Output/);
  });

  it('图片模型不能同时设置按张价和按 token 价', async () => {
    const id = await addModel('image', 'i1');
    await expect(
      savePrice(id, { image: '0.04', input: '5', output: '40' })
    ).rejects.toThrow(/either Per image OR token-based/);
  });

  it('语音合成模型必须有每百万字符价，转写模型必须有每秒价', async () => {
    const tts = await addModel('audio', 'tts1', { supportsSpeech: true });
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

describe('计费', () => {
  it('聊天：缓存命中的 token 不按输入价计，按缓存价计', async () => {
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

  it('聊天：推理 token 单独计，不重复计入输出', async () => {
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

  it('按调用时的价格计费；之后改价，已有记录不变', async () => {
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

    const [before, after] = await usageRows();
    expect(Number(before.cost)).toBeCloseTo(1, 10);
    expect(Number(before.inputPrice)).toBe(1);
    expect(Number(after.cost)).toBeCloseTo(5, 10);
  });

  it('图片：有按张价时按张数计，不看 token', async () => {
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

  it('图片：按 token 计价时，按输入、输出 token 计', async () => {
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

  it('视频：按秒计价时，按秒数计', async () => {
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

  it('视频：按个计价时，按个数计，不看秒数', async () => {
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

  it('语音合成：按字数 × 每百万字符价计', async () => {
    const id = await addModel('audio', 'tts1', { supportsSpeech: true });
    await savePrice(id, { audioCharacters: '15' });
    await recordAudioUsage({ ...call, modelId: 'tts1', audioCharacters: 86 });
    expect(Number((await usageRows())[0].cost)).toBeCloseTo(0.00129, 10);
  });

  it('转写：按秒数 × 每秒价计', async () => {
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

describe('额度', () => {
  it('没有额度的用户，调用前被拒绝', async () => {
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaMissingError);
  });

  it('不限额的额度，不检查用量', async () => {
    await giveQuota(null, null, { isUnlimited: true });
    await spent('1000');
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });

  it('已用低于上限就放行，不管这次调用要花多少', async () => {
    await giveQuota('3', '20');
    await spent('2.99');
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });

  it('已用达到上限就拒绝', async () => {
    await giveQuota('3', '20');
    await spent('3');
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('超出上限的费用照常计入，之后的调用被拒绝，直到它移出 5 小时窗口', async () => {
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

  it('同时开始的调用，检查时互相看不到对方的费用，都会放行', async () => {
    await giveQuota('3', '20');
    await spent('2.99');
    const checks = await Promise.allSettled([
      assertQuota('u1'),
      assertQuota('u1'),
      assertQuota('u1')
    ]);
    expect(checks.every(c => c.status === 'fulfilled')).toBe(true);
  });

  it('5 小时额度和每周额度分别检查，任一达到上限就拒绝', async () => {
    await giveQuota('3', '20');
    // Under the 5-hour cap now, but the week has reached its own.
    await spent('20', new Date(Date.now() - 24 * HOUR));
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('聊天、图片、视频、语音、转写的费用计入同一个额度', async () => {
    await giveQuota('3', '20');
    await spent('1', new Date(), 'image');
    await spent('1', new Date(), 'video');
    await spent('1', new Date(), 'audio');
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('额度设了可用模型时，其他模型调用前被拒绝；没设时所有模型都可用', async () => {
    await giveQuota('3', '20', { allowedModelIds: ['c1'] });
    await expect(assertModelAccess('u1', 'c1', 'c1')).resolves.toBeUndefined();
    await expect(assertModelAccess('u1', 'c2', 'c2')).rejects.toBeInstanceOf(
      ModelAccessDeniedError
    );

    await giveQuota('3', '20');
    await expect(assertModelAccess('u1', 'c2', 'c2')).resolves.toBeUndefined();
  });
});
