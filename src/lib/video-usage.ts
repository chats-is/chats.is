/**
 * Best-effort extraction of the ACTUAL generated video duration (seconds) from
 * a video model's `providerMetadata`.
 *
 * The AI SDK's video result carries no standardized usage, but several
 * providers report the real clip length under provider-specific metadata, e.g.
 *   providerMetadata.fal.videos[0].duration  // { duration: 5, fps: 24, ... }
 * We scan each provider entry for a `videos[].duration` or a top-level
 * `duration`. Returns undefined when no provider surfaced it — callers fall
 * back to the requested duration.
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
 * Resolve the billable video duration in seconds: prefer the provider-reported
 * actual duration, fall back to the duration the client requested. Returns
 * undefined when neither is available (caller should treat as "unknown" and
 * surface it, not silently bill 0).
 */
export function resolveVideoSeconds(
  providerMetadata: unknown,
  requestedDuration: unknown
): number | undefined {
  const actual = extractVideoDurationSeconds(providerMetadata);
  if (actual !== undefined) return actual;
  return typeof requestedDuration === 'number' && requestedDuration > 0
    ? requestedDuration
    : undefined;
}
