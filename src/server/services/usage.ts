import '@tanstack/react-start/server-only';

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type RecordAudioUsageInput,
  type RecordChatUsageInput,
  type RecordImageUsageInput,
  type RecordTranscriptionUsageInput,
  type RecordVideoUsageInput,
  type UsageRow,
  type UserUsageRow
} from '@/types';
import { type usageLogFilterSchema } from '@/types/usage';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { models, providers, usage, users } from '@/db/schema';
import {
  calculateAudioCost,
  calculateChatCost,
  calculateImageCost,
  calculateTranscriptionCost,
  calculateVideoCost,
  resolveModelByKey
} from '@/server/services/pricing';

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

    await db.insert(usage).values({
      id: generateUUID(),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId ?? lookup?.model.providerId,
      capability: 'chat',
      inputTokens: input.usage.inputTokens ?? 0,
      outputTokens: input.usage.outputTokens ?? 0,
      cacheReadTokens: input.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: input.usage.cacheWriteTokens ?? 0,
      reasoningTokens: input.usage.reasoningTokens ?? 0,
      cost: cost.toString(),
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
        parseNumber(pricing.output) != null);
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
        outputTokens: input.outputTokens
      },
      pricing
    );

    await db.insert(usage).values({
      id: generateUUID(),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId ?? lookup?.model.providerId,
      capability: 'image',
      imageCount: input.imageCount,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      cost: cost.toString(),
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

    await db.insert(usage).values({
      id: generateUUID(),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId ?? lookup?.model.providerId,
      capability: 'video',
      videoCount: input.videoCount,
      videoSeconds: (input.videoSeconds ?? 0).toString(),
      cost: cost.toString(),
      ...snapshot
    });
  } catch (err) {
    console.error('Failed to record video usage:', err);
  }
}

/**
 * Record usage for an audio (TTS / STT / audio chat) call.
 */
export async function recordAudioUsage(
  input: RecordAudioUsageInput
): Promise<void> {
  try {
    const lookup = await resolveModelByKey(input.modelId, 'audio');
    const pricing = lookup?.pricing ?? null;

    // Speech bills per character. No quantity means a cost of 0 — surface it.
    if (
      pricing != null &&
      parseNumber(pricing.audioCharacters) != null &&
      (input.audioCharacters ?? 0) === 0
    ) {
      console.warn(
        `[audio] no billable quantity for model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateAudioCost(
      { audioCharacters: input.audioCharacters },
      pricing
    );

    await db.insert(usage).values({
      id: generateUUID(),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId ?? lookup?.model.providerId,
      capability: 'audio',
      audioCharacters: input.audioCharacters ?? 0,
      audioInputTokens: input.audioInputTokens ?? 0,
      audioOutputTokens: input.audioOutputTokens ?? 0,
      cost: cost.toString(),
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

    // Per-second billed: without a duration the cost would be 0 — surface it.
    const secondsBilled =
      pricing != null && parseNumber(pricing.audioSeconds) != null;
    if (secondsBilled && (input.audioSeconds ?? 0) === 0) {
      console.warn(
        `[transcription] no duration reported for model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateTranscriptionCost(
      { audioSeconds: input.audioSeconds },
      pricing
    );

    await db.insert(usage).values({
      id: generateUUID(),
      userId: input.userId,
      chatId: input.chatId ?? null,
      messageId: input.messageId,
      modelId: lookup?.model.modelId ?? input.modelId,
      providerId: input.providerId ?? lookup?.model.providerId,
      capability: 'audio',
      audioSeconds: (input.audioSeconds ?? 0).toString(),
      cost: cost.toString(),
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
// `createdAt >= since` on a timestamptz column, a pure instant comparison,
// which keeps the KPI window and the browser's local-day chart buckets
// aligned so the total equals the sum of the bars.
// =========================================================================

// `from` is an absolute instant computed client-side from the user's LOCAL
// calendar-day boundary (start of (today - N + 1) at local 00:00). The server
// does no timezone math — it filters `createdAt >= from` on the timestamptz
// column, a pure instant comparison. This keeps the KPI window and the
// browser's local-day chart buckets aligned (KPI total == sum of bars).

// =============================================================================
// KPI tile aggregate — TZ-independent (sums over the whole window)
//
// `queryKpi` is admin-facing and returns cost. `queryKpiUser` strips the
// dollar field — user-end procedures must never expose cost.
// =============================================================================
async function queryKpiUser(args: { since: Date; userId: string }) {
  const { totalCost: _totalCost, ...tokensOnly } = await queryKpi(args);
  return tokensOnly;
}

async function queryUsageRowsUser(args: {
  since: Date;
  userId: string;
}): Promise<UserUsageRow[]> {
  const rows = await queryUsageRows(args);
  return rows.map(({ cost: _cost, ...rest }) => rest);
}

async function queryKpi(args: { since: Date; userId?: string }) {
  const baseWhere = and(
    gte(usage.createdAt, args.since),
    args.userId ? eq(usage.userId, args.userId) : undefined
  );
  const rows = await db
    .select({
      totalCost: sql<string>`coalesce(sum(${usage.cost}), 0)`,
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usage.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usage.outputTokens}), 0)`,
      cacheReadTokens: sql<number>`coalesce(sum(${usage.cacheReadTokens}), 0)`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usage.cacheWriteTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${usage.reasoningTokens}), 0)`
    })
    .from(usage)
    .where(baseWhere);
  const row = rows[0];
  return {
    totalCost: row?.totalCost ?? '0',
    requests: Number(row?.requests ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    cacheReadTokens: Number(row?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(row?.cacheWriteTokens ?? 0),
    reasoningTokens: Number(row?.reasoningTokens ?? 0)
  };
}

// =============================================================================
// Raw rows — no day bucketing happens here. The browser will group these by
// its own local calendar day, which is the only TZ-aware authority in the
// pipeline (and the same TZ used to render the Logs table — guarantees the
// chart and the Logs agree on which day a record belongs to).
// =============================================================================

async function queryUsageRows(args: {
  since: Date;
  userId?: string;
}): Promise<UsageRow[]> {
  const where = and(
    gte(usage.createdAt, args.since),
    args.userId ? eq(usage.userId, args.userId) : undefined
  );
  const rows = await db
    .select({
      id: usage.id,
      createdAt: usage.createdAt,
      modelId: usage.modelId,
      providerId: providers.id,
      providerName: providers.name,
      capability: usage.capability,
      cost: usage.cost,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens
    })
    .from(usage)
    .leftJoin(models, eq(models.modelId, usage.modelId))
    .leftJoin(providers, eq(providers.id, models.providerId))
    .where(where)
    .orderBy(usage.createdAt);
  return rows.map(r => ({
    id: r.id,
    createdAt: r.createdAt,
    modelId: r.modelId,
    providerId: r.providerId,
    providerName: r.providerName,
    capability: r.capability,
    cost: r.cost ?? '0',
    inputTokens: Number(r.inputTokens ?? 0),
    outputTokens: Number(r.outputTokens ?? 0),
    cacheReadTokens: Number(r.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(r.cacheWriteTokens ?? 0),
    reasoningTokens: Number(r.reasoningTokens ?? 0)
  }));
}

/** A KPI tile and the rows behind it — what every usage screen asks for. The
 *  user-end variant drops cost: user-facing procedures never expose dollars. */
export async function getMyUsage(userId: string, since: Date) {
  const [kpi, rows] = await Promise.all([
    queryKpiUser({ since, userId }),
    queryUsageRowsUser({ since, userId })
  ]);
  return { kpi, rows };
}

export async function adminUsageByUser(userId: string, since: Date) {
  const [kpi, rows] = await Promise.all([
    queryKpi({ since, userId }),
    queryUsageRows({ since, userId })
  ]);
  return { kpi, rows };
}

export async function adminListUsage(since: Date) {
  const [kpi, rows] = await Promise.all([
    queryKpi({ since }),
    queryUsageRows({ since })
  ]);
  return { kpi, rows };
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

/** The admin usage log: one page of rows, plus the total behind it. */
export async function adminUsageLog(
  data: z.infer<typeof usageLogFilterSchema>
) {
  const whereParts = [
    data.from ? gte(usage.createdAt, data.from) : undefined,
    data.to ? lte(usage.createdAt, data.to) : undefined,
    data.userId ? eq(usage.userId, data.userId) : undefined,
    data.modelId ? eq(usage.modelId, data.modelId) : undefined,
    data.capability ? eq(usage.capability, data.capability) : undefined
  ];

  let userIds: string[] | null = null;
  if (data.userQuery?.trim()) {
    const q = `%${data.userQuery.trim()}%`;
    const matched = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`(${users.name} ilike ${q} or ${users.email} ilike ${q})`)
      .limit(200);
    userIds = matched.map(u => u.id);
    if (userIds.length === 0) {
      return {
        rows: [],
        total: 0,
        page: data.page,
        pageSize: data.pageSize
      };
    }
  }
  const userWhere =
    userIds !== null
      ? sql`${usage.userId} in (${sql.join(
          userIds.map(id => sql`${id}`),
          sql`, `
        )})`
      : undefined;

  const where = and(...whereParts.filter(Boolean), userWhere);

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
      capability: usage.capability,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      reasoningTokens: usage.reasoningTokens,
      imageCount: usage.imageCount,
      videoCount: usage.videoCount,
      videoSeconds: usage.videoSeconds,
      audioInputTokens: usage.audioInputTokens,
      audioOutputTokens: usage.audioOutputTokens,
      audioCharacters: usage.audioCharacters,
      inputPrice: usage.inputPrice,
      outputPrice: usage.outputPrice,
      cacheReadPrice: usage.cacheReadPrice,
      cacheWritePrice: usage.cacheWritePrice,
      reasoningPrice: usage.reasoningPrice,
      imagePrice: usage.imagePrice,
      videoPrice: usage.videoPrice,
      videoSecondsPrice: usage.videoSecondsPrice,
      audioInputPrice: usage.audioInputPrice,
      audioOutputPrice: usage.audioOutputPrice,
      audioCharactersPrice: usage.audioCharactersPrice,
      cost: usage.cost
    })
    .from(usage)
    .leftJoin(users, eq(users.id, usage.userId))
    .where(where)
    .orderBy(desc(usage.createdAt))
    .limit(data.pageSize)
    .offset((data.page - 1) * data.pageSize);

  return { rows, total, page: data.page, pageSize: data.pageSize };
}
