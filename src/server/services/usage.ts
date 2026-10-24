import '@tanstack/react-start/server-only';

import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  gte,
  lt,
  or,
  sql
} from 'drizzle-orm';
import { type z } from 'zod';

import {
  type RecordAudioUsageInput,
  type RecordChatUsageInput,
  type RecordImageUsageInput,
  type RecordTranscriptionUsageInput,
  type RecordVideoUsageInput,
  type UserTier
} from '@/types';
import { type usageLogFilterSchema } from '@/types/usage';
import { applyMultiplier } from '@/lib/billing';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { models, providers, tiers, usage, users } from '@/db/schema';
import { dayOf, sumOf } from '@/server/services/db-utils';
import {
  calculateAudioCost,
  calculateChatCost,
  calculateImageCost,
  calculateTranscriptionCost,
  calculateVideoCost,
  resolveModelByKey
} from '@/server/services/pricing';
import { getUserTier } from '@/server/services/tier';

/**
 * The money columns of a row: what the call cost, the tier the user was on
 * and its multiplier, and what they spent — cost × multiplier. Quotas and
 * every total count the spend.
 */
function spent(cost: number, tier: UserTier) {
  return {
    cost: cost.toString(),
    tierId: tier.tier?.id ?? null,
    priceMultiplier: tier.priceMultiplier.toString(),
    spend: applyMultiplier(cost, tier.priceMultiplier).toString()
  };
}

/**
 * The row's id — chosen before the call where the call carried it — and the
 * provider's own ids for the calls it records.
 */
function callIds(input: Pick<RecordChatUsageInput, 'id' | 'providerRequests'>) {
  return {
    id: input.id ?? generateUUID(),
    providerRequests: input.providerRequests?.length
      ? input.providerRequests
      : null
  };
}

/** The plan a user is on as the call is recorded; null when on none. */
async function planOf(userId: string) {
  const [row] = await db
    .select({ planId: users.planId })
    .from(users)
    .where(eq(users.id, userId));
  return row?.planId ?? null;
}

/**
 * Compute cost and insert a usage row for a chat completion.
 * Safe to call inside onFinish callbacks; failures are logged but never thrown.
 */
export async function recordChatUsage(
  input: RecordChatUsageInput
): Promise<void> {
  try {
    const lookup = await resolveModelByKey(input.modelId, 'chat');

    // Chat is always token-billed (input + output required). A row with no
    // tokens at all would bill 0 — surface it (the route already returns early
    // when usage is entirely absent; this catches a present-but-empty usage).
    const u = input.usage;
    const noTokens =
      (u.inputTokens ?? 0) === 0 &&
      (u.outputTokens ?? 0) === 0 &&
      (u.cacheReadTokens ?? 0) === 0 &&
      (u.cacheWriteTokens ?? 0) === 0 &&
      (u.reasoningTokens ?? 0) === 0;
    if (noTokens) {
      console.warn(
        `[chat] no token usage for model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateChatCost(
      input.usage,
      lookup?.pricing ?? null
    );
    const tier = await getUserTier(input.userId);

    await db.insert(usage).values({
      ...callIds(input),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId,
      providerModelId: input.providerModelId ?? null,
      capability: 'chat',
      inputTokens: input.usage.inputTokens ?? 0,
      outputTokens: input.usage.outputTokens ?? 0,
      cacheReadTokens: input.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: input.usage.cacheWriteTokens ?? 0,
      reasoningTokens: input.usage.reasoningTokens ?? 0,
      webSearches: input.usage.webSearches ?? 0,
      xPosts: input.usage.xPosts ?? 0,
      xProfiles: input.usage.xProfiles ?? 0,
      ...spent(cost, tier),
      planId: await planOf(input.userId),
      ...snapshot
    });
  } catch (err) {
    console.error('Failed to record chat usage:', err);
  }
}

/**
 * Record usage for an image generation call.
 */
export async function recordImageUsage(
  input: RecordImageUsageInput
): Promise<void> {
  try {
    const lookup = await resolveModelByKey(input.modelId, 'image');
    const pricing = lookup?.pricing ?? null;

    // Token-billed image model (per-image price unset, but input/output rates
    // set, e.g. gpt-image-1 / Gemini) that reported no token usage would bill
    // 0 — surface the gap instead of silently under-charging.
    const tokenBilled =
      pricing != null &&
      parseNumber(pricing.image) == null &&
      (parseNumber(pricing.input) != null ||
        parseNumber(pricing.imageOutput) != null);
    const noTokens =
      (input.inputTokens ?? 0) === 0 && (input.outputTokens ?? 0) === 0;
    if (tokenBilled && noTokens) {
      console.warn(
        `[image] no token usage for token-billed model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateImageCost(
      {
        imageCount: input.imageCount,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        imageInputTokens: input.imageInputTokens,
        imageOutputTokens: input.imageOutputTokens
      },
      pricing
    );
    const tier = await getUserTier(input.userId);

    await db.insert(usage).values({
      ...callIds(input),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId,
      providerModelId: input.providerModelId ?? null,
      capability: 'image',
      imageCount: input.imageCount,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      imageInputTokens: input.imageInputTokens ?? 0,
      imageOutputTokens: input.imageOutputTokens ?? 0,
      ...spent(cost, tier),
      planId: await planOf(input.userId),
      ...snapshot
    });
  } catch (err) {
    console.error('Failed to record image usage:', err);
  }
}

/**
 * Record usage for a video generation call.
 */
export async function recordVideoUsage(
  input: RecordVideoUsageInput
): Promise<void> {
  try {
    const lookup = await resolveModelByKey(input.modelId, 'video');
    const pricing = lookup?.pricing ?? null;

    // Per-second-billed model (flat per-video price unset, per-second set) that
    // got no duration would bill 0 — surface it. Per-video models bill on
    // videoCount (always present), so they don't warn.
    const perSecondBilled =
      pricing != null &&
      parseNumber(pricing.video) == null &&
      parseNumber(pricing.videoSeconds) != null;
    if (perSecondBilled && (input.videoSeconds ?? 0) === 0) {
      console.warn(
        `[video] no duration for per-second model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateVideoCost(
      { videoCount: input.videoCount, videoSeconds: input.videoSeconds },
      pricing
    );
    const tier = await getUserTier(input.userId);

    await db.insert(usage).values({
      ...callIds(input),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId,
      providerModelId: input.providerModelId ?? null,
      capability: 'video',
      videoCount: input.videoCount,
      videoSeconds: (input.videoSeconds ?? 0).toString(),
      ...spent(cost, tier),
      planId: await planOf(input.userId),
      ...snapshot
    });
  } catch (err) {
    console.error('Failed to record video usage:', err);
  }
}

/** How many tokens an audio call reported, of any kind. */
const tokensOf = (tokens: {
  inputTokens?: number;
  outputTokens?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
}) =>
  (tokens.inputTokens ?? 0) +
  (tokens.outputTokens ?? 0) +
  (tokens.audioInputTokens ?? 0) +
  (tokens.audioOutputTokens ?? 0);

/**
 * Record usage for an audio (TTS / STT / audio chat) call.
 */
export async function recordAudioUsage(
  input: RecordAudioUsageInput
): Promise<void> {
  try {
    const lookup = await resolveModelByKey(input.modelId, 'audio');
    const pricing = lookup?.pricing ?? null;

    // Speech bills per character, or per token where the provider counts
    // them. No quantity means a cost of 0 — surface it.
    const billable =
      pricing == null ||
      (parseNumber(pricing.audioCharacters) != null
        ? (input.audioCharacters ?? 0) > 0
        : tokensOf(input) > 0);
    if (!billable) {
      console.warn(
        `[audio] no billable quantity for model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateAudioCost(input, pricing);
    const tier = await getUserTier(input.userId);

    await db.insert(usage).values({
      ...callIds(input),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId,
      providerModelId: input.providerModelId ?? null,
      capability: 'audio',
      audioCharacters: input.audioCharacters ?? 0,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      audioInputTokens: input.audioInputTokens ?? 0,
      audioOutputTokens: input.audioOutputTokens ?? 0,
      ...spent(cost, tier),
      planId: await planOf(input.userId),
      ...snapshot
    });
  } catch (err) {
    console.error('Failed to record audio usage:', err);
  }
}

/**
 * Compute cost and insert a usage row for a transcription (STT) call.
 * Safe to call inside tool execution; failures are logged but never thrown.
 */
export async function recordTranscriptionUsage(
  input: RecordTranscriptionUsageInput
): Promise<void> {
  try {
    const lookup = await resolveModelByKey(input.modelId, 'audio');
    const pricing = lookup?.pricing ?? null;

    // Billed by length, or per token where the provider counts them:
    // without either the cost would be 0 — surface it.
    const billable =
      pricing == null ||
      (parseNumber(pricing.audioMinute) != null
        ? (input.audioSeconds ?? 0) > 0
        : tokensOf(input) > 0);
    if (!billable) {
      console.warn(
        `[transcription] nothing billable reported for model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateTranscriptionCost(input, pricing);
    const tier = await getUserTier(input.userId);

    await db.insert(usage).values({
      ...callIds(input),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId,
      providerModelId: input.providerModelId ?? null,
      capability: 'audio',
      audioSeconds: (input.audioSeconds ?? 0).toString(),
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      audioInputTokens: input.audioInputTokens ?? 0,
      ...spent(cost, tier),
      planId: await planOf(input.userId),
      ...snapshot
    });
  } catch (err) {
    console.error('Failed to record transcription usage:', err);
  }
}

// =========================================================================
// Reporting
//
// `since` is an absolute instant the browser computed from its own local
// calendar-day boundary. Nothing here does timezone maths: it filters
// `createdAt >= since` on a timestamptz column, and numbers the days every
// 86,400 seconds from `since` (`dayOf`), so each is one of the browser's
// local days and the totals equal the sum of the days. Over a window of
// one day, a "day" is an hour: `step` is the seconds between them.
// =========================================================================

/**
 * The console's usage from `since` to `until` — everyone's, or one user's:
 * each day's, and each day's for every model, provider and capability, which
 * the cards and the table add up. SQL sums the calls once, by day, model,
 * provider and capability together, and those few rows are added up here
 * into each of the four. A day is every 86,400 seconds from `since`,
 * numbered from 1, and only the days and groups with calls come. With them,
 * the install's models and providers in the order they were added, which
 * fixes the colour each is drawn in.
 */
export async function adminUsageStats(
  since: Date,
  until?: Date,
  userId?: string,
  step?: number
) {
  const used = db.$with('used').as(
    db
      .select({
        day: dayOf(since, usage.createdAt, step).as('day'),
        modelId: usage.modelId,
        providerId: usage.providerId,
        // The provider that served the call, as the row recorded it.
        providerName: sql<string | null>`${providers.name}`.as('provider_name'),
        capability: usage.capability,
        spend: usage.spend,
        cost: usage.cost,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        reasoningTokens: usage.reasoningTokens,
        imageCount: usage.imageCount,
        imageInputTokens: usage.imageInputTokens,
        imageOutputTokens: usage.imageOutputTokens,
        videoCount: usage.videoCount,
        webSearches: usage.webSearches,
        xPosts: usage.xPosts,
        xProfiles: usage.xProfiles
      })
      .from(usage)
      .leftJoin(providers, eq(providers.id, usage.providerId))
      .where(
        and(
          gte(usage.createdAt, since),
          until ? lt(usage.createdAt, until) : undefined,
          userId ? eq(usage.userId, userId) : undefined
        )
      )
  );
  const figures = {
    spend: sumOf(used.spend),
    cost: sumOf(used.cost),
    inputTokens: sumOf(used.inputTokens),
    outputTokens: sumOf(used.outputTokens),
    cacheReadTokens: sumOf(used.cacheReadTokens),
    cacheWriteTokens: sumOf(used.cacheWriteTokens),
    reasoningTokens: sumOf(used.reasoningTokens),
    // Of the input and output tokens, the pictures read and drawn.
    imageInputTokens: sumOf(used.imageInputTokens),
    imageOutputTokens: sumOf(used.imageOutputTokens),
    images: sumOf(used.imageCount),
    videos: sumOf(used.videoCount),
    // The calls that spoke or heard speech, however much of it.
    audios:
      sql<number>`count(*) filter (where ${used.capability} = 'audio')`.mapWith(
        Number
      ),
    webSearches: sumOf(used.webSearches),
    xPosts: sumOf(used.xPosts),
    xProfiles: sumOf(used.xProfiles)
  };

  const [rows, modelsAdded, providersAdded] = await Promise.all([
    db
      .with(used)
      .select({
        day: used.day,
        modelId: used.modelId,
        providerId: used.providerId,
        providerName: used.providerName,
        capability: used.capability,
        ...figures
      })
      .from(used)
      .groupBy(
        used.day,
        used.modelId,
        used.providerId,
        used.providerName,
        used.capability
      ),
    db
      .select({ modelId: models.modelId })
      .from(models)
      .orderBy(models.createdAt, models.id),
    db
      .select({ id: providers.id, type: providers.type })
      .from(providers)
      .orderBy(providers.createdAt, providers.id)
  ]);

  const names = Object.keys(figures) as Array<keyof typeof figures>;
  type Figures = Record<keyof typeof figures, number>;
  type Sum<TKey> = TKey & { day: number } & Figures;
  /** The rows added up by day and by what `by` takes from each. */
  const sumBy = <TKey extends object>(
    by: (r: (typeof rows)[number]) => TKey
  ) => {
    const sums = new Map<string, Sum<TKey>>();
    for (const r of rows) {
      const head = { day: r.day, ...by(r) };
      const id = JSON.stringify(head);
      const sum =
        sums.get(id) ??
        ({
          ...head,
          ...Object.fromEntries(names.map(n => [n, 0]))
        } as Sum<TKey>);
      for (const n of names) sum[n] += r[n];
      sums.set(id, sum);
    }
    return [...sums.values()];
  };

  return {
    days: sumBy(() => ({})),
    models: sumBy(r => ({ key: r.modelId })),
    providers: sumBy(r => ({ key: r.providerId, name: r.providerName })),
    capabilities: sumBy(r => ({ key: r.capability })),
    catalog: {
      models: modelsAdded.map(m => m.modelId),
      providers: providersAdded
    }
  };
}

/**
 * How many users called a model from `since` to `until`: over the whole of
 * it, and on each of its days that had any. A user active on several days
 * is one user of the whole.
 */
export async function activeUsers(since: Date, until?: Date, step?: number) {
  const used = db.$with('used').as(
    db
      .select({
        day: dayOf(since, usage.createdAt, step).as('day'),
        userId: usage.userId
      })
      .from(usage)
      .where(
        and(
          gte(usage.createdAt, since),
          until ? lt(usage.createdAt, until) : undefined
        )
      )
  );
  // Each day's and the whole's in one read: the grouping by no column is
  // the whole, and comes even with no calls.
  const rows = await db
    .with(used)
    .select({
      day: used.day,
      whole: sql<number>`grouping(${used.day})`.mapWith(Number),
      activeUsers: countDistinct(used.userId)
    })
    .from(used)
    .groupBy(sql`grouping sets ((${used.day}), ())`);
  return {
    total: rows.find(r => r.whole === 1)?.activeUsers ?? 0,
    days: rows
      .filter(r => r.whole === 0)
      .map(r => ({ day: r.day, activeUsers: r.activeUsers }))
  };
}

/** Distinct models one user has spent on — the filter list on their detail
 *  page in the console. */
export async function adminUserModels(userId: string) {
  const rows = await db
    .select({ modelId: usage.modelId })
    .from(usage)
    .where(eq(usage.userId, userId))
    .groupBy(usage.modelId)
    .orderBy(usage.modelId);
  return rows.map(r => r.modelId).filter((id): id is string => Boolean(id));
}

/** The row an id names: by its own id, or by one its provider gave a call
 *  it records. */
function namedBy(id: string) {
  const call = (key: 'requestId' | 'responseId') =>
    sql`${usage.providerRequests} @> ${JSON.stringify([{ [key]: id }])}::jsonb`;
  return or(eq(usage.id, id), call('requestId'), call('responseId'));
}

/** The admin usage log: one page of rows, plus the total behind it. */
export async function adminUsageLog(
  data: z.infer<typeof usageLogFilterSchema>
) {
  const whereParts = [
    data.from ? gte(usage.createdAt, data.from) : undefined,
    data.to ? lt(usage.createdAt, data.to) : undefined,
    data.userId ? eq(usage.userId, data.userId) : undefined,
    data.modelId ? eq(usage.modelId, data.modelId) : undefined,
    data.capability ? eq(usage.capability, data.capability) : undefined
  ];

  // Users by name or address, in part, or by their id whole.
  const query = data.userQuery?.trim();
  let userIds: string[] | null = null;
  if (query) {
    const q = `%${query}%`;
    const matched = await db
      .select({ id: users.id })
      .from(users)
      .where(
        sql`(${users.name} ilike ${q} or ${users.email} ilike ${q} or ${users.id} = ${query})`
      )
      .limit(200);
    userIds = matched.map(u => u.id);
  }
  const userWhere =
    userIds === null
      ? undefined
      : userIds.length > 0
        ? sql`${usage.userId} in (${sql.join(
            userIds.map(id => sql`${id}`),
            sql`, `
          )})`
        : sql`false`;

  // The same box takes a record's id, or one its provider gave a call; the
  // window and the other filters hold for it as for a user.
  const where = and(
    ...whereParts.filter(Boolean),
    query ? or(userWhere, namedBy(query)) : undefined
  );

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usage)
    .where(where);
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      id: usage.id,
      createdAt: usage.createdAt,
      userId: usage.userId,
      userName: users.name,
      userEmail: users.email,
      modelId: usage.modelId,
      providerModelId: usage.providerModelId,
      providerRequests: usage.providerRequests,
      // Who served the call, as the row recorded it.
      providerName: providers.name,
      capability: usage.capability,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
      webSearches: usage.webSearches,
      xPosts: usage.xPosts,
      xProfiles: usage.xProfiles,
      imageCount: usage.imageCount,
      imageInputTokens: usage.imageInputTokens,
      imageOutputTokens: usage.imageOutputTokens,
      videoCount: usage.videoCount,
      videoSeconds: usage.videoSeconds,
      audioInputTokens: usage.audioInputTokens,
      audioOutputTokens: usage.audioOutputTokens,
      audioCharacters: usage.audioCharacters,
      audioSeconds: usage.audioSeconds,
      inputPrice: usage.inputPrice,
      outputPrice: usage.outputPrice,
      cacheReadPrice: usage.cacheReadPrice,
      cacheWritePrice: usage.cacheWritePrice,
      reasoningPrice: usage.reasoningPrice,
      webSearchPrice: usage.webSearchPrice,
      xPostPrice: usage.xPostPrice,
      xProfilePrice: usage.xProfilePrice,
      imagePrice: usage.imagePrice,
      imageInputPrice: usage.imageInputPrice,
      imageOutputPrice: usage.imageOutputPrice,
      videoPrice: usage.videoPrice,
      videoSecondsPrice: usage.videoSecondsPrice,
      audioInputPrice: usage.audioInputPrice,
      audioOutputPrice: usage.audioOutputPrice,
      audioCharactersPrice: usage.audioCharactersPrice,
      audioMinutePrice: usage.audioMinutePrice,
      cost: usage.cost,
      // The tier as it is named today; the multiplier as it stood then.
      tierName: tiers.name,
      priceMultiplier: usage.priceMultiplier,
      spend: usage.spend
    })
    .from(usage)
    .leftJoin(users, eq(users.id, usage.userId))
    .leftJoin(providers, eq(providers.id, usage.providerId))
    .leftJoin(tiers, eq(tiers.id, usage.tierId))
    .where(where)
    // `id` last so the order is total: rows recorded in the same instant would
    // otherwise sort arbitrarily, and offset paging over an order that leaves
    // ties unbroken can repeat a row on one page and skip it on the next.
    .orderBy(desc(usage.createdAt), asc(usage.id))
    .limit(data.pageSize)
    .offset((data.page - 1) * data.pageSize);

  return { rows, total, page: data.page, pageSize: data.pageSize };
}
