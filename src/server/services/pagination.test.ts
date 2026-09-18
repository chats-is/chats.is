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
 * The console's tables read one page at a time, which means the narrowing, the
 * count and the window all happen in SQL. That SQL is what these tests are for:
 * a search that reaches a joined provider row, a count that ignores the window,
 * and an order total enough that no row lands on two pages.
 *
 * Run against a real Postgres (PGlite) with the real migrations, because the
 * subquery and the count are the parts a mock would quietly get wrong.
 */
const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));

// The provider service masks keys through lib/crypto, which reads the server
// env on import. Key handling is not what these tests are about, so it is
// stubbed rather than given a fake APP_SECRET to derive from.
vi.mock('@/lib/crypto', () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
  maskedKey: () => '****'
}));

const { listModels } = await import('@/server/services/model');
const { listProviders } = await import('@/server/services/provider');
const { listPricingWithModels } = await import('@/server/services/pricing');
const { listPlans } = await import('@/server/services/plan');
const { adminListPrompts } = await import('@/server/services/prompt');
const { listShares } = await import('@/server/services/share');
const { listUsers } = await import('@/server/services/user');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;
});

afterAll(async () => {
  await client?.close?.();
});

beforeEach(async () => {
  // FK order: pricing → model → provider; shares → chats; then users, plans.
  await h.db.delete(schema.modelPricings);
  await h.db.delete(schema.models);
  await h.db.delete(schema.providers);
  await h.db.delete(schema.prompts);
  await h.db.delete(schema.shares);
  await h.db.delete(schema.chats);
  await h.db.delete(schema.users);
  await h.db.delete(schema.plans);
  await h.db.delete(schema.quotas);
});

const seedProvider = async (id: string, name: string) => {
  await h.db.insert(schema.providers).values({
    id,
    name,
    type: 'openai',
    apiKey: 'k',
    isEnabled: true,
    displayOrder: 0
  });
};

/** Every model shares a display order and a capability, so only the id breaks
 *  the tie — which is exactly the case offset paging can get wrong. */
const seedModels = async (count: number, providerId: string) => {
  await h.db.insert(schema.models).values(
    Array.from({ length: count }, (_, i) => ({
      id: `m-${String(i).padStart(3, '0')}`,
      name: `Model ${i}`,
      modelId: `model-${i}`,
      providerId,
      capability: 'chat' as const,
      isEnabled: true,
      displayOrder: 0
    }))
  );
};

describe('listModels', () => {
  beforeEach(async () => {
    await seedProvider('p-openai', 'OpenAI');
    await seedModels(25, 'p-openai');
  });

  it('returns one page and the total behind it', async () => {
    const first = await listModels({ page: 1, pageSize: 10 });

    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.page).toBe(1);
  });

  it('cuts the last page short rather than padding it', async () => {
    const last = await listModels({ page: 3, pageSize: 10 });

    expect(last.rows).toHaveLength(5);
    expect(last.total).toBe(25);
  });

  it('puts every row on exactly one page', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map(page => listModels({ page, pageSize: 10 }))
    );
    const ids = pages.flatMap(p => p.rows.map(r => r.id));

    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('counts what the filter matches, not what the page holds', async () => {
    const page = await listModels({ page: 1, pageSize: 10, q: 'Model 1' });

    // Model 1, and 10 through 19.
    expect(page.total).toBe(11);
    expect(page.rows).toHaveLength(10);
  });

  it('searches the model id as well as the name', async () => {
    const page = await listModels({ page: 1, pageSize: 50, q: 'model-24' });

    expect(page.rows.map(r => r.modelId)).toEqual(['model-24']);
  });

  it('searches the provider name through the join', async () => {
    await seedProvider('p-xai', 'xAI');
    await h.db.insert(schema.models).values({
      id: 'm-grok',
      name: 'Grok',
      modelId: 'grok-4',
      providerId: 'p-xai',
      capability: 'chat' as const,
      isEnabled: true,
      displayOrder: 0
    });

    const page = await listModels({ page: 1, pageSize: 50, q: 'xAI' });

    expect(page.total).toBe(1);
    expect(page.rows.map(r => r.modelId)).toEqual(['grok-4']);
  });

  it('reports an empty page rather than failing past the end', async () => {
    const page = await listModels({ page: 99, pageSize: 10 });

    expect(page.rows).toEqual([]);
    expect(page.total).toBe(25);
  });

  it('narrows by capability and by search together', async () => {
    await h.db.insert(schema.models).values({
      id: 'm-dalle',
      name: 'Model image',
      modelId: 'dall-e-3',
      providerId: 'p-openai',
      capability: 'image' as const,
      isEnabled: true,
      displayOrder: 0
    });

    const page = await listModels({
      page: 1,
      pageSize: 50,
      capability: 'image',
      q: 'Model'
    });

    expect(page.rows.map(r => r.modelId)).toEqual(['dall-e-3']);
  });
});

describe('listProviders', () => {
  beforeEach(async () => {
    await seedProvider('p-1', 'OpenAI');
    await seedProvider('p-2', 'Anthropic');
  });

  it('pages, and keeps the key masked', async () => {
    const page = await listProviders({ page: 1, pageSize: 1 });

    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.rows[0]).not.toHaveProperty('apiKey');
    expect(page.rows[0]).toHaveProperty('maskedKey');
  });

  it('searches the type as well as the name', async () => {
    expect((await listProviders({ page: 1, pageSize: 10, q: 'openai' })).total)
      // Both rows are of type `openai`; one is also named it.
      .toBe(2);
    expect(
      (await listProviders({ page: 1, pageSize: 10, q: 'Anthropic' })).total
    ).toBe(1);
  });
});

describe('listPricingWithModels', () => {
  beforeEach(async () => {
    await seedProvider('p-openai', 'OpenAI');
    await seedModels(25, 'p-openai');
  });

  it('pages, and pairs each model with its pricing row or null', async () => {
    const page = await listPricingWithModels({ page: 2, pageSize: 10 });

    expect(page.rows).toHaveLength(10);
    expect(page.total).toBe(25);
    expect(page.rows.every(r => r.pricing === null)).toBe(true);
  });

  it('searches the provider name through the join', async () => {
    const page = await listPricingWithModels({
      page: 1,
      pageSize: 10,
      q: 'OpenAI'
    });

    expect(page.total).toBe(25);
  });

  it('finds nothing for a provider nobody has', async () => {
    const page = await listPricingWithModels({
      page: 1,
      pageSize: 10,
      q: 'Cohere'
    });

    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });
});

describe('listPlans', () => {
  beforeEach(async () => {
    await h.db
      .insert(schema.quotas)
      .values({ id: 'q-1', name: 'Standard', isUnlimited: false });
    await h.db.insert(schema.plans).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: `pl-${i}`,
        name: `Plan ${i}`,
        quotaId: 'q-1',
        displayOrder: 0
      }))
    );
    await h.db.insert(schema.users).values([
      {
        id: 'u-a',
        name: 'A',
        email: 'a@example.com',
        emailVerified: true,
        planId: 'pl-0'
      },
      {
        id: 'u-b',
        name: 'B',
        email: 'b@example.com',
        emailVerified: true,
        planId: 'pl-0'
      },
      {
        id: 'u-c',
        name: 'C',
        email: 'c@example.com',
        emailVerified: true,
        planId: 'pl-4'
      }
    ]);
  });

  it('counts users per plan across every page, not just this one', async () => {
    const first = await listPlans({ page: 1, pageSize: 2 });
    const last = await listPlans({ page: 3, pageSize: 2 });

    expect(first.total).toBe(5);
    expect(first.rows.map(p => [p.id, p.userCount])).toEqual([
      ['pl-0', 2],
      ['pl-1', 0]
    ]);
    // The count for a plan on the last page is right even though the grouped
    // scan ran alongside a window that excluded it.
    expect(last.rows.map(p => [p.id, p.userCount])).toEqual([['pl-4', 1]]);
  });
});

describe('adminListPrompts', () => {
  beforeEach(async () => {
    await h.db.insert(schema.users).values({
      id: 'u-owner',
      name: 'Owner',
      email: 'owner@example.com',
      emailVerified: true
    });
    await h.db.insert(schema.prompts).values(
      Array.from({ length: 8 }, (_, i) => ({
        id: `pr-${i}`,
        userId: 'u-owner',
        name: `Prompt ${i}`,
        content: i === 7 ? 'a needle in here' : 'hay',
        visibility: 'public' as const,
        displayOrder: 0
      }))
    );
  });

  it('pages over the whole gallery', async () => {
    const page = await adminListPrompts({ page: 2, pageSize: 3 });

    expect(page.rows).toHaveLength(3);
    expect(page.total).toBe(8);
  });

  it('searches the content as well as the name', async () => {
    const byContent = await adminListPrompts({
      page: 1,
      pageSize: 10,
      search: 'needle'
    });
    const byName = await adminListPrompts({
      page: 1,
      pageSize: 10,
      search: 'Prompt 3'
    });

    expect(byContent.rows.map(p => p.id)).toEqual(['pr-7']);
    expect(byName.rows.map(p => p.id)).toEqual(['pr-3']);
  });
});

describe('listUsers', () => {
  beforeEach(async () => {
    await h.db.insert(schema.users).values(
      Array.from({ length: 12 }, (_, i) => ({
        id: `u-${String(i).padStart(3, '0')}`,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        emailVerified: true,
        // One shared timestamp, so only the id breaks the tie.
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z')
      }))
    );
  });

  it('puts every user on exactly one page', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map(page => listUsers({ page, pageSize: 5 }))
    );
    const ids = pages.flatMap(p => p.rows.map(r => r.id));

    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(pages[0].total).toBe(12);
  });

  it('counts the whole match when narrowed by email', async () => {
    const page = await listUsers({ page: 1, pageSize: 5, search: 'user1' });

    // user1, and user10 and user11.
    expect(page.total).toBe(3);
  });
});

describe('listShares', () => {
  /** Two users, so a count scoped to the wrong one would show up. */
  beforeEach(async () => {
    await h.db.insert(schema.users).values([
      {
        id: 'u-mine',
        name: 'Mine',
        email: 'mine@example.com',
        emailVerified: true
      },
      {
        id: 'u-other',
        name: 'Other',
        email: 'other@example.com',
        emailVerified: true
      }
    ]);

    const rows = [
      ...Array.from({ length: 14 }, (_, i) => ({ owner: 'u-mine', i })),
      ...Array.from({ length: 6 }, (_, i) => ({ owner: 'u-other', i: 100 + i }))
    ];
    // One shared timestamp throughout, so only the id breaks the tie.
    const at = new Date('2026-01-01T00:00:00Z');
    await h.db.insert(schema.chats).values(
      rows.map(({ owner, i }) => ({
        id: `c-${i}`,
        title: `Chat ${i}`,
        modelId: 'gpt-4o',
        userId: owner,
        createdAt: at,
        updatedAt: at
      }))
    );
    await h.db.insert(schema.shares).values(
      rows.map(({ owner, i }) => ({
        id: `s-${String(i).padStart(3, '0')}`,
        chatId: `c-${i}`,
        userId: owner,
        createdAt: at
      }))
    );
  });

  it('counts the caller own links only, not everyone else', async () => {
    const page = await listShares('u-mine', { page: 1, pageSize: 10 });

    expect(page.total).toBe(14);
    expect(page.rows).toHaveLength(10);
  });

  it('puts every link on exactly one page', async () => {
    const pages = await Promise.all(
      [1, 2].map(page => listShares('u-mine', { page, pageSize: 10 }))
    );
    const ids = pages.flatMap(p => p.rows.map(r => r.id));

    expect(ids).toHaveLength(14);
    expect(new Set(ids).size).toBe(14);
  });

  it('carries the chat behind each link, without its owner', async () => {
    const page = await listShares('u-mine', { page: 2, pageSize: 10 });

    expect(page.rows).toHaveLength(4);
    expect(page.rows[0].chat?.title).toMatch(/^Chat /);
    expect(page.rows[0].chat).not.toHaveProperty('userId');
  });

  it('reports nothing for a user who has shared nothing', async () => {
    const page = await listShares('u-nobody', { page: 1, pageSize: 10 });

    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });
});
