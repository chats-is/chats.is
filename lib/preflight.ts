import 'server-only';

import { NextResponse } from 'next/server';

import type { ChatErrorKind } from '@/types';
import { PricingMissingError, requirePricing } from '@/lib/pricing';
import {
  assertModelAccess,
  assertQuota,
  ModelAccessDeniedError,
  QuotaExceededError
} from '@/lib/quota';

export type PreflightResult =
  | { ok: true }
  /** `kind` travels with the message so callers can persist the cause, not just
   *  the prose — see CustomUIDataTypes['error']. */
  | { ok: false; status: 403 | 429; message: string; kind: ChatErrorKind };

/**
 * Run the standard pre-flight gates for any generation:
 *   1. Model must have a pricing row                 → 403
 *   2. User's resolved quota must allow this model   → 403
 *   3. User must be under their quota windows        → 429 (with resetAt)
 *
 * `modelKey` is the modelId string (e.g. "gpt-4o"); used for both the pricing
 * lookup and the quota model-whitelist check (quota.allowedModelIds stores
 * modelId strings, matching everywhere else in the system).
 *
 * Transport-agnostic variant: returns a result object instead of an HTTP
 * response, so it can also gate in-stream tool calls (chat media tools).
 */
export async function preflightCheck(args: {
  userId: string;
  modelKey: string;
  modelLabel: string;
  capability: 'chat' | 'image' | 'video' | 'audio';
  /** Audio direction: true = STT (per-second pricing), false = TTS. */
  transcription?: boolean;
}): Promise<PreflightResult> {
  try {
    await requirePricing(args.modelKey, args.capability, args.modelLabel, {
      transcription: args.transcription
    });
    await assertModelAccess(args.userId, args.modelKey, args.modelLabel);
    await assertQuota(args.userId);
    return { ok: true };
  } catch (err) {
    if (err instanceof PricingMissingError) {
      // Log the admin-facing detail (which model, what's missing) so the
      // misconfiguration is discoverable; the user only sees a generic
      // "unavailable, pick another model" message.
      console.error(`[preflight] ${err.message}`);
      return {
        ok: false,
        status: 403,
        message: err.userMessage,
        kind: 'pricing'
      };
    }
    if (err instanceof ModelAccessDeniedError) {
      return {
        ok: false,
        status: 403,
        message: err.message,
        kind: 'model-access'
      };
    }
    if (err instanceof QuotaExceededError) {
      // Plain message only — the live UsageLimitAlert (powered by
      // `quota.me`) already shows the user the remaining-% gauge + countdown
      // when they're exhausted, so the 429 doesn't need structured detail.
      return { ok: false, status: 429, message: err.message, kind: 'quota' };
    }
    throw err;
  }
}

/**
 * HTTP wrapper over `preflightCheck` for route handlers.
 * Returns a NextResponse to bail out with, or null to proceed.
 */
export async function preflightGate(args: {
  userId: string;
  modelKey: string;
  modelLabel: string;
  capability: 'chat' | 'image' | 'video' | 'audio';
  transcription?: boolean;
}): Promise<NextResponse | null> {
  const result = await preflightCheck(args);
  if (result.ok) {
    return null;
  }
  return NextResponse.json(
    { error: result.message },
    { status: result.status }
  );
}
