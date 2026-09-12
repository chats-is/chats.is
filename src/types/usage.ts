import { z } from 'zod';

import { modelCapabilitySchema } from './model';
import { type ChatUsage } from './pricing';

/** Shared input fields for `recordXxxUsage` writers. */
type RecordUsageBase = {
  userId: string;
  chatId?: string | null;
  messageId?: string;
  modelId: string; // external modelId, e.g. 'gpt-4o'
  providerId?: string;
};

export type RecordChatUsageInput = RecordUsageBase & {
  usage: ChatUsage;
};

export type RecordImageUsageInput = RecordUsageBase & {
  imageCount: number;
  // Token counts for token-billed image models (e.g. gpt-image-1). Ignored
  // when the model bills per image. Cached input is not exposed by the image
  // API, so inputTokens is billed in full at the input rate.
  inputTokens?: number;
  outputTokens?: number;
};

export type RecordVideoUsageInput = RecordUsageBase & {
  videoCount: number;
  videoSeconds?: number;
};

export type RecordAudioUsageInput = RecordUsageBase & {
  // Classic TTS bills per character (input text length). Token-based audio
  // models bill per input/output token. Mutually exclusive per model.
  audioCharacters?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
};

export type RecordTranscriptionUsageInput = RecordUsageBase & {
  // STT bills per second of input audio (transcribe() reports
  // durationInSeconds; no token usage is exposed).
  audioSeconds?: number;
};

/** Raw row shape returned from `usage` router queries. The browser owns
 *  "which local day this row belongs to" (see `bucketByLocalDay`). */
export type UsageRow = {
  id: string;
  createdAt: Date | string;
  modelId: string | null;
  providerId: string | null;
  providerName: string | null;
  capability: 'chat' | 'image' | 'video' | 'audio';
  cost: string | number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

/** Aggregated KPI tile values for the period — admin shape (with cost). */
export type UsageKpi = {
  totalCost: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

/** User-facing KPI shape. No cost / dollar fields — only token counts. */
export type UserUsageKpi = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

/** User-facing log row shape. No cost field. */
export type UserUsageRow = {
  id: string;
  createdAt: Date | string;
  modelId: string | null;
  providerId: string | null;
  providerName: string | null;
  capability: 'chat' | 'image' | 'video' | 'audio';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

/** Minimal row shape consumed by the `UsageQuantity` cell renderer.
 *  Compatible with `UsageRow` but only the fields it actually reads. */
export type UsageRowLike = {
  capability: 'chat' | 'image' | 'video' | 'audio';
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  imageCount?: number | null;
  videoCount?: number | null;
  videoSeconds?: string | number | null;
  audioInputTokens?: number | null;
  audioOutputTokens?: number | null;
  audioCharacters?: number | null;
  audioSeconds?: string | number | null;
  // Per-unit price snapshot (USD per unit at compute time). Optional — only
  // the admin log surfaces these for the "Unit Price" column.
  inputPrice?: string | null;
  outputPrice?: string | null;
  cacheReadPrice?: string | null;
  cacheWritePrice?: string | null;
  reasoningPrice?: string | null;
  imagePrice?: string | null;
  videoPrice?: string | null;
  videoSecondsPrice?: string | null;
  audioInputPrice?: string | null;
  audioOutputPrice?: string | null;
  audioCharactersPrice?: string | null;
  audioSecondsPrice?: string | null;
};

/** Sum-by-group for a single day, used by the daily stacked bar chart. */
export type DailyGroup = {
  key: string;
  label: string;
  cost: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

/** Daily bucket: the day key + the per-group sums for that day. */
export type DailyDay = {
  day: string;
  groups: DailyGroup[];
};

/**
 * What the usage server functions accept.
 *
 * `from` is an absolute instant the browser computed from its own local
 * calendar-day boundary. Nothing on the server does timezone maths — it
 * filters on a timestamptz column — which keeps the KPI window and the
 * browser's local-day chart buckets aligned.
 */
export const usageRangeSchema = z.object({ from: z.date() });

export const usageByUserRangeSchema = z.object({
  userId: z.string().min(1),
  from: z.date()
});

export const usageUserSchema = z.object({ userId: z.string().min(1) });

/** What the admin log may be narrowed by. */
export const usageLogFilterSchema = z.object({
  from: z.date().optional(),
  to: z.date().optional(),
  userId: z.string().optional(),
  userQuery: z.string().optional(),
  modelId: z.string().optional(),
  capability: modelCapabilitySchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50)
});
