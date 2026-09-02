import '@tanstack/react-start/server-only'

import { eq, inArray } from 'drizzle-orm'

import type { PricingSource, PricingSyncResult, ProviderType } from '@/types'
import { BedrockModels, VertexAIModels } from '@/lib/constant'
import { generateUUID, parseNumber } from '@/lib/utils'
import { db } from '@/server/db'
import { modelPricings, models } from '@/server/db/schema'

const SOURCE_URLS: Record<PricingSource, string> = {
  'models.dev': 'https://models.dev/api.json',
  'llm-metadata': 'https://basellm.github.io/llm-metadata/api/all.json',
}

type RemoteCost = {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
  /** Distinct reasoning rate (Qwen-style models). Most models leave this off
   *  and reasoning is billed at the output rate. */
  reasoning?: number
  // Some providers expose audio-specific rates
  input_audio?: number
  output_audio?: number
  // llm-metadata-specific
  per_image?: number
  per_second?: number
}

type RemoteModel = {
  id?: string
  name?: string
  cost?: RemoteCost
}

type RemoteProvider = {
  id?: string
  models?: Record<string, RemoteModel>
}

type RemoteData = Record<string, RemoteProvider>

/**
 * Fetch the remote pricing dataset for a source.
 */
async function fetchRemote(source: PricingSource): Promise<RemoteData> {
  const url = SOURCE_URLS[source]
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${source}: ${res.status} ${res.statusText}`,
    )
  }
  return (await res.json()) as RemoteData
}

/**
 * Resolve our internal (provider.type, model.modelId) → the remote pricing
 * data's (providerId, modelId) pair.
 *
 * Most providers map 1:1 (same name) and the modelId is used as-is. Two
 * exceptions:
 *   - `bedrock`  : remote provider is `amazon-bedrock`; the modelId must be
 *                  translated via BedrockModels (e.g. claude-opus-4-5 →
 *                  anthropic.claude-opus-4-5-20251101-v1:0).
 *   - `vertex`   : Anthropic-on-Vertex models go under `google-vertex-anthropic`
 *                  with the @date-suffixed modelId from VertexAIModels;
 *                  Gemini-on-Vertex stays under `google-vertex` with the
 *                  modelId as-is.
 *
 * Returns null if a translation is required but not configured (e.g. a
 * Bedrock model whose modelId isn't in BedrockModels).
 *
 * Both models.dev and llm-metadata use the same provider keys, so a single
 * mapping covers both sources.
 */
function resolveRemoteRef(
  type: ProviderType,
  modelId: string,
): { providerId: string; modelId: string } | null {
  switch (type) {
    case 'bedrock': {
      const remoteId = BedrockModels[modelId]
      if (!remoteId) return null
      return { providerId: 'amazon-bedrock', modelId: remoteId }
    }
    case 'vertex': {
      const claudeId = VertexAIModels[modelId]
      if (claudeId) {
        return { providerId: 'google-vertex-anthropic', modelId: claudeId }
      }
      return { providerId: 'google-vertex', modelId }
    }
    case 'openai':
    case 'azure':
    case 'google':
    case 'anthropic':
    case 'xai':
    case 'deepseek':
      return { providerId: type, modelId }
  }
}

function findRemoteCost(
  data: RemoteData,
  type: ProviderType,
  modelId: string,
): { cost: RemoteCost; providerId: string; modelId: string } | null {
  const ref = resolveRemoteRef(type, modelId)
  if (!ref) return null
  const cost = data[ref.providerId]?.models?.[ref.modelId]?.cost
  if (!cost) return null
  return { cost, providerId: ref.providerId, modelId: ref.modelId }
}

/**
 * Preview what would change for a given list of model.id values if synced.
 * Does not write to the database.
 */
export async function previewSync(args: {
  source: PricingSource
  modelDbIds?: string[] // models.id (PK), not modelId
}): Promise<
  Array<{
    modelDbId: string
    modelId: string
    modelName: string
    matched: boolean
    remote: RemoteCost | null
    current: {
      input?: number
      output?: number
      cacheRead?: number
      cacheWrite?: number
    } | null
  }>
> {
  const data = await fetchRemote(args.source)

  const allModels = await db.query.models.findMany({
    where: args.modelDbIds?.length
      ? inArray(models.id, args.modelDbIds)
      : undefined,
    with: { pricings: { limit: 1 }, provider: true },
  })

  return allModels.map((m) => {
    const type = m.provider?.type as ProviderType | undefined
    const remote = type ? findRemoteCost(data, type, m.modelId) : null
    const current = m.pricings[0]
    return {
      modelDbId: m.id,
      modelId: m.modelId,
      modelName: m.name,
      matched: !!remote,
      remote: remote?.cost ?? null,
      current: current
        ? {
            input: numOrUndef(current.input),
            output: numOrUndef(current.output),
            cacheRead: numOrUndef(current.cacheRead),
            cacheWrite: numOrUndef(current.cacheWrite),
          }
        : null,
    }
  })
}

/**
 * Sync prices from an external source for the given model IDs.
 *
 * For each model, look up remote cost and upsert the single pricing row
 * (one row per model — see schema).
 *
 * Returns counts of matched/updated/created/unchanged + list of unmatched ids.
 */
export async function syncPricing(args: {
  source: PricingSource
  modelDbIds?: string[] // models.id (PK)
  onlyMissing?: boolean // skip models that already have pricing
}): Promise<PricingSyncResult> {
  const data = await fetchRemote(args.source)
  const result: PricingSyncResult = {
    matched: 0,
    updated: 0,
    created: 0,
    unchanged: 0,
    notFound: [],
  }

  const targets = await db.query.models.findMany({
    where: args.modelDbIds?.length
      ? inArray(models.id, args.modelDbIds)
      : undefined,
    with: { pricings: { limit: 1 }, provider: true },
  })

  for (const m of targets) {
    const type = m.provider?.type as ProviderType | undefined
    const remote = type ? findRemoteCost(data, type, m.modelId) : null
    if (!remote) {
      result.notFound.push(m.modelId)
      continue
    }
    result.matched += 1

    const existing = m.pricings[0]
    if (existing && args.onlyMissing) {
      result.unchanged += 1
      continue
    }

    const valuesToWrite = {
      modelId: m.modelId,
      input: toNumeric(remote.cost.input),
      output: toNumeric(remote.cost.output),
      // Cache R/W default to "0" (free) when the remote doesn't list them,
      // so the cost engine doesn't fall back to input rate.
      cacheRead: toNumeric(remote.cost.cache_read) ?? '0',
      cacheWrite: toNumeric(remote.cost.cache_write) ?? '0',
      // Reasoning stays null when not provided — calc falls back to output rate.
      reasoning: toNumeric(remote.cost.reasoning),
      image: toNumeric(remote.cost.per_image),
      // Token-based audio rates (gpt-4o-mini-tts, omni). Classic TTS bills per
      // character — the remote sources don't list a per-character rate, so
      // audioCharacters is configured manually (left untouched by sync).
      audioInput: toNumeric(remote.cost.input_audio),
      audioOutput: toNumeric(remote.cost.output_audio),
      source: args.source,
      updatedAt: new Date(),
    }

    if (existing) {
      // Numeric compare — DB stores "0.0010000000" but remote returns "0.001".
      // String equality would flag those as changed and trigger useless writes.
      const numEq = (a: string | null, b: string | null) =>
        parseNumber(a) === parseNumber(b)
      const changed =
        !numEq(valuesToWrite.input, existing.input) ||
        !numEq(valuesToWrite.output, existing.output) ||
        !numEq(valuesToWrite.cacheRead, existing.cacheRead) ||
        !numEq(valuesToWrite.cacheWrite, existing.cacheWrite) ||
        !numEq(valuesToWrite.reasoning, existing.reasoning) ||
        !numEq(valuesToWrite.image, existing.image) ||
        !numEq(valuesToWrite.audioInput, existing.audioInput) ||
        !numEq(valuesToWrite.audioOutput, existing.audioOutput) ||
        existing.source !== args.source

      if (!changed) {
        result.unchanged += 1
        continue
      }

      await db
        .update(modelPricings)
        .set(valuesToWrite)
        .where(eq(modelPricings.id, existing.id))
      result.updated += 1
    } else {
      await db.insert(modelPricings).values({
        id: generateUUID(),
        ...valuesToWrite,
        createdAt: new Date(),
      })
      result.created += 1
    }
  }

  return result
}

/**
 * Search remote pricing data by free-text query (modelId substring).
 * Useful when admin wants to discover what a remote has.
 */
export async function searchRemotePricing(args: {
  source: PricingSource
  query?: string
  limit?: number
}): Promise<
  Array<{
    providerId: string
    modelId: string
    name: string
    cost: RemoteCost
  }>
> {
  const data = await fetchRemote(args.source)
  const q = args.query?.toLowerCase().trim()
  const limit = args.limit ?? 50
  const out: Array<{
    providerId: string
    modelId: string
    name: string
    cost: RemoteCost
  }> = []

  for (const [providerId, provider] of Object.entries(data)) {
    if (!provider?.models) continue
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!model.cost) continue
      if (q) {
        const hay = `${modelId} ${model.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      out.push({
        providerId,
        modelId,
        name: model.name ?? modelId,
        cost: model.cost,
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

const toNumeric = (n: number | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n) ? n.toString() : null

const numOrUndef = (v: string | null): number | undefined => {
  if (v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
