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

/** The same, with several providers' listings. */
const catalogue = (
  data: Record<string, Record<string, { cost: Record<string, number> }>>
) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        Object.fromEntries(
          Object.entries(data).map(([id, models]) => [id, { id, models }])
        )
      )
    )
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
    // The source's output is the picture's; the words' is not its to say.
    expect(Number(price.imageOutput)).toBe(40);
    expect(price.output).toBeNull();
    expect(pricingMissingFields('image', price)).toEqual([]);
  });

  it('finds a model the source lists only under its one version', async () => {
    remote({ 'gpt-x@default': { cost: { input: 3, output: 6 } } });

    const result = await sync.runPricingSync({
      source: 'models.dev',
      modelDbIds: ['m-chat']
    });
    const price = await priceOf('gpt-x');

    expect(result.updated).toBe(1);
    expect(Number(price.input)).toBe(3);
    expect(Number(price.output)).toBe(6);
  });

  it('does not guess between several versions of a model', async () => {
    remote({
      'gpt-x@2026-01': { cost: { input: 3, output: 6 } },
      'gpt-x@2026-06': { cost: { input: 5, output: 9 } }
    });

    const result = await sync.runPricingSync({
      source: 'models.dev',
      modelDbIds: ['m-chat']
    });

    expect(result.notFound).toEqual(['gpt-x']);
    expect(Number((await priceOf('gpt-x')).input)).toBe(1);
  });

  describe('a model served by two providers', () => {
    // OpenAI first by priority, and off; xAI second, sent an id of its own.
    beforeEach(async () => {
      await h.db.insert(schema.providers).values({
        id: 'p2',
        name: 'xAI',
        type: 'xai',
        apiKey: 'x',
        isEnabled: true
      });
      await h.db
        .update(schema.modelProviders)
        .set({ isEnabled: false })
        .where(eq(schema.modelProviders.id, 'b1'));
      await h.db.insert(schema.modelProviders).values({
        id: 'b3',
        modelId: 'gpt-x',
        providerId: 'p2',
        providerModelId: 'grok-x',
        priority: 1
      });
    });

    it('is priced once, from its first provider, on or off', async () => {
      catalogue({
        openai: { 'gpt-x': { cost: { input: 3, output: 6 } } },
        xai: { 'grok-x': { cost: { input: 7, output: 8 } } }
      });

      const rows = await sync.previewPricingSync({
        source: 'models.dev',
        modelDbIds: ['m-chat']
      });
      const result = await sync.runPricingSync({
        source: 'models.dev',
        modelDbIds: ['m-chat']
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        providerName: 'OpenAI',
        matched: true,
        remote: { input: 3, output: 6 }
      });
      expect(result.updated).toBe(1);
      expect(Number((await priceOf('gpt-x')).input)).toBe(3);
    });

    it('is not looked up by the id another provider is sent', async () => {
      catalogue({ xai: { 'grok-x': { cost: { input: 7, output: 8 } } } });

      const result = await sync.runPricingSync({
        source: 'models.dev',
        modelDbIds: ['m-chat']
      });

      expect(result.notFound).toEqual(['gpt-x']);
    });
  });

  it('finds a model by an alias when the source lists it by that', async () => {
    await h.db
      .update(schema.models)
      .set({ aliases: ['gpt-x-latest', 'gpt-x-alias'] })
      .where(eq(schema.models.id, 'm-chat'));
    remote({ 'gpt-x-alias': { cost: { input: 3, output: 6 } } });

    const result = await sync.runPricingSync({
      source: 'models.dev',
      modelDbIds: ['m-chat']
    });

    expect(result.updated).toBe(1);
    expect(Number((await priceOf('gpt-x')).input)).toBe(3);
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
