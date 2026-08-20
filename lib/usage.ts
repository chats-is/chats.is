import 'server-only';

import type {
  RecordAudioUsageInput,
  RecordChatUsageInput,
  RecordImageUsageInput,
  RecordTranscriptionUsageInput,
  RecordVideoUsageInput
} from '@/types';
import {
  calculateAudioCost,
  calculateChatCost,
  calculateImageCost,
  calculateTranscriptionCost,
  calculateVideoCost,
  resolveModelByKey
} from '@/lib/pricing';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/server/db';
import { usage } from '@/server/db/schema';

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

    // Char-billed (classic TTS) needs characters; token-billed needs tokens.
    // If the billed dimension has no quantity, cost would be 0 — surface it.
    const charBilled =
      pricing != null && parseNumber(pricing.audioCharacters) != null;
    const tokenBilled =
      pricing != null &&
      !charBilled &&
      (parseNumber(pricing.audioInput) != null ||
        parseNumber(pricing.audioOutput) != null);
    const noChars = (input.audioCharacters ?? 0) === 0;
    const noTokens =
      (input.audioInputTokens ?? 0) === 0 &&
      (input.audioOutputTokens ?? 0) === 0;
    if ((charBilled && noChars) || (tokenBilled && noTokens)) {
      console.warn(
        `[audio] no billable quantity for model=${input.modelId}; cost will be 0`
      );
    }

    const { cost, snapshot } = calculateAudioCost(
      {
        audioCharacters: input.audioCharacters,
        audioInputTokens: input.audioInputTokens,
        audioOutputTokens: input.audioOutputTokens
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
