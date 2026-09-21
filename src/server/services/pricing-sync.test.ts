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

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

const sync = await import('./pricing-sync');
const { pricingMissingFields } = await import('./pricing');

let client: { close?: () => Promise<void> } | undefined;

/** What the price source answers with, for this test. */
const remote = (models: Record<string, { cost: Record<string, number> }>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ openai: { id: 'openai', models } }))
  );

const priceOf = async (modelId: string) =>
  (
    await h.db
      .select()
      .from(schema.modelPricings)
      .where(eq(schema.modelPricings.modelId, modelId))
  )[0];

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await h.db.delete(schema.modelPricings);
  await h.db.delete(schema.modelProviders);
  await h.db.delete(schema.models);
  await h.db.delete(schema.providers);

  await h.db.insert(schema.providers).values({
    id: 'p1',
    name: 'OpenAI',
    type: 'openai',
    apiKey: 'x',
    isEnabled: true
  });
  await h.db.insert(schema.models).values([
    { id: 'm-chat', name: 'Chat', modelId: 'gpt-x', capability: 'chat' },
    { id: 'm-image', name: 'Image', modelId: 'img-x', capability: 'image' }
  ]);
  await h.db.insert(schema.modelProviders).values([
    { id: 'b1', modelId: 'gpt-x', providerId: 'p1' },
    { id: 'b2', modelId: 'img-x', providerId: 'p1' }
  ]);
  // Both priced by hand, and both working.
  await h.db.insert(schema.modelPricings).values([
    { id: 'pr1', modelId: 'gpt-x', input: '1', output: '4', source: 'manual' },
    { id: 'pr2', modelId: 'img-x', image: '0.04', source: 'manual' }
  ]);
});

describe('price sync', () => {
  /**
   * The sources are partial. One that knew a chat model's input price and not
   * its output used to write null over the output an admin had entered — and
   * a chat model with no output rate is refused at the gate, for everyone.
   */
  it('keeps a rate the source does not list', async () => {
    remote({ 'gpt-x': { cost: { input: 2 } } });

    const result = await sync.runPricingSync({
      source: 'models.dev',
      modelDbIds: ['m-chat']
    });
    const price = await priceOf('gpt-x');

    expect(result.updated).toBe(1);
    expect(Number(price.input)).toBe(2);
    expect(Number(price.output)).toBe(4);
    expect(pricingMissingFields('chat', price)).toEqual([]);
  });

  it('follows a provider that changed how an image model is billed', async () => {
    // Priced per image by hand; the source now lists token rates and no
    // per-image price at all. That is a change of style, not a partial entry.
    remote({ 'img-x': { cost: { input: 5, output: 40 } } });

    const result = await sync.runPricingSync({
      source: 'models.dev',
      modelDbIds: ['m-image']
    });
    const price = await priceOf('img-x');

    expect(result.updated).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(price.image).toBeNull();
    expect(Number(price.input)).toBe(5);
    expect(pricingMissingFields('image', price)).toEqual([]);
  });

  it('leaves a working model alone rather than price it two ways', async () => {
    // The source lists both styles at once, which says nothing about which
    // one applies — and both written down is a row with no defined cost.
    remote({ 'img-x': { cost: { input: 5, output: 40, per_image: 0.05 } } });

    const result = await sync.runPricingSync({
      source: 'models.dev',
      modelDbIds: ['m-image']
    });
    const price = await priceOf('img-x');

    expect(result.updated).toBe(0);
    expect(result.skipped.map(entry => entry.modelId)).toEqual(['img-x']);
    expect(price.input).toBeNull();
    expect(Number(price.image)).toBe(0.04);
  });
});
