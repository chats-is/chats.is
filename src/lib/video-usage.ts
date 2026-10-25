/**
 * Best-effort extraction of the ACTUAL generated video duration (seconds) from
 * a video model's `providerMetadata`.
 *
 * The AI SDK's video result carries no standardized usage, but several
 * providers report the real clip length under provider-specific metadata, e.g.
 *   providerMetadata.fal.videos[0].duration  // { duration: 5, fps: 24, ... }
 * We scan each provider entry for a `videos[].duration` or a top-level
 * `duration`. Returns undefined when no provider surfaced it — callers read
 * the length from the video itself.
 */
export function extractVideoDurationSeconds(
  providerMetadata: unknown
): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return undefined;
  }
  for (const entry of Object.values(
    providerMetadata as Record<string, unknown>
  )) {
    if (!entry || typeof entry !== 'object') continue;
    const meta = entry as {
      duration?: unknown;
      videos?: Array<{ duration?: unknown } | null> | null;
    };
    const candidates = [meta.videos?.[0]?.duration, meta.duration];
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    }
  }
  return undefined;
}

/**
 * The tokens a video model counted a clip as, where it prices clips by the
 * token and says how many — ByteDance's Seedance, under
 * `providerMetadata.bytedance.usage.completion_tokens`. Undefined when no
 * provider reported any.
 */
export function extractVideoTokens(
  providerMetadata: unknown
): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return undefined;
  }
  for (const entry of Object.values(
    providerMetadata as Record<string, unknown>
  )) {
    if (!entry || typeof entry !== 'object') continue;
    const tokens = (entry as { usage?: { completion_tokens?: unknown } | null })
      .usage?.completion_tokens;
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) {
      return tokens;
    }
  }
  return undefined;
}
