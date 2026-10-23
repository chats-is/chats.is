import { z } from 'zod';

import { modelCapabilitySchema } from './model';
import { type ChatUsage } from './pricing';

/**
 * How a provider knows one of its calls, to find it again in its own logs:
 * the id of what it answered, and the id it gave the request. Either may be
 * missing — Google names no request, a media call names no response.
 */
export type ProviderRequest = {
  responseId?: string;
  requestId?: string;
};

/** Shared input fields for `recordXxxUsage` writers. */
type RecordUsageBase = {
  /** The row's id, when it was chosen before the call so the call could
   *  carry it. Absent, one is made as the row is written. */
  id?: string;
  userId: string;
  chatId?: string | null;
  messageId?: string;
  modelId: string; // external modelId, e.g. 'gpt-4o'
  /**
   * The provider that actually served the call — required, because it is the
   * only record of it. A model's pairings say who could serve it today, which
   * is not who did months ago, so a row written without this can never be
   * told which provider it belongs to.
   */
  providerId: string;
  /** The id the provider was asked for, when it differs from the model's. */
  providerModelId?: string | null;
  /** The provider's ids for each call the row records, in order. */
  providerRequests?: ProviderRequest[];
};

export type RecordChatUsageInput = RecordUsageBase & {
  usage: ChatUsage;
};

export type RecordImageUsageInput = RecordUsageBase & {
  imageCount: number;
  // Token counts for token-billed image models (e.g. gpt-image-1). Ignored
  // when the model bills per image. Cached input is not exposed by the image
  // API, so inputTokens is billed in full at the input rates.
  inputTokens?: number;
  outputTokens?: number;
  /** Of those, the pictures read and drawn, billed at the image rates. */
  imageInputTokens?: number;
  imageOutputTokens?: number;
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

/** Minimal row shape the usage breakdown (`lib/usage-breakdown.ts`) reads.
 *  Only the fields it actually reads. */
export type UsageRowLike = {
  capability: 'chat' | 'image' | 'video' | 'audio';
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number | null;
  webSearches?: number | null;
  xPosts?: number | null;
  xProfiles?: number | null;
  imageCount?: number | null;
  imageInputTokens?: number | null;
  imageOutputTokens?: number | null;
  videoCount?: number | null;
  videoSeconds?: string | number | null;
  audioInputTokens?: number | null;
  audioOutputTokens?: number | null;
  audioCharacters?: number | null;
  audioSeconds?: string | number | null;
  /** The multiplier the row's prices are read at: the tier's, as it stood.
   *  The rates below are cost prices; what the user paid is each times this. */
  priceMultiplier?: string | number | null;
  // Per-unit price snapshot (USD per unit at compute time). Optional — only
  // the admin log surfaces these for the "Unit Price" column.
  inputPrice?: string | null;
  outputPrice?: string | null;
  cacheReadPrice?: string | null;
  cacheWritePrice?: string | null;
  reasoningPrice?: string | null;
  webSearchPrice?: string | null;
  xPostPrice?: string | null;
  xProfilePrice?: string | null;
  imagePrice?: string | null;
  imageInputPrice?: string | null;
  imageOutputPrice?: string | null;
  videoPrice?: string | null;
  videoSecondsPrice?: string | null;
  audioInputPrice?: string | null;
  audioOutputPrice?: string | null;
  audioCharactersPrice?: string | null;
  audioSecondsPrice?: string | null;
};

/** A report window in the address: a preset of the last N days, or a range
 *  of local calendar days as `'YYYY-MM-DD'`, both ends included. */
const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const reportWindowSearchSchema = z.object({
  days: z.coerce.number().int().positive().optional(),
  from: dayKeySchema.optional(),
  to: dayKeySchema.optional()
});

/**
 * A report window: from `from`, up to but not including `to` when given.
 *
 * `from` is an absolute instant the browser computed from its own local
 * calendar-day boundary. Nothing on the server does timezone maths — it
 * filters on a timestamptz column — which keeps the totals and the
 * browser's local days aligned.
 */
export const usageRangeSchema = z.object({
  from: z.date(),
  to: z.date().optional(),
  /** By the hour rather than the day: a window of one day, which as days
   *  would be a single point. */
  hourly: z.boolean().optional()
});

/** The usage figures over a window: everyone's, or one user's. */
export const usageStatsSchema = usageRangeSchema.extend({
  userId: z.string().min(1).optional()
});

export const usageUserSchema = z.object({ userId: z.string().min(1) });

/** What the admin log may be narrowed by. */
export const usageLogFilterSchema = z.object({
  from: z.date().optional(),
  /** Up to but not including — the start of the day after the last. */
  to: z.date().optional(),
  userId: z.string().optional(),
  /** A user's name, address or id — or a record's id, or one its provider
   *  gave a call it records. */
  userQuery: z.string().optional(),
  modelId: z.string().optional(),
  capability: modelCapabilitySchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50)
});
