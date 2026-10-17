import '@tanstack/react-start/server-only';

import { eq, inArray } from 'drizzle-orm';

import {
  type PricingSource,
  type PricingSyncResult,
  type ProviderType
} from '@/types';
import { generateUUID, parseNumber } from '@/lib/utils';
import { db } from '@/db';
import { modelPricings, models } from '@/db/schema';
import {
  pricingMissingFields,
  pricingStyleConflict
} from '@/server/services/pricing';

const SOURCE_URLS: Record<PricingSource, string> = {
  'models.dev': 'https://models.dev/api.json',
  'llm-metadata': 'https://basellm.github.io/llm-metadata/api/all.json'
};

type RemoteCost = {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  /** Distinct reasoning rate (Qwen-style models). Most models leave this off
   *  and reasoning is billed at the output rate. */
  reasoning?: number;
  // Some providers expose audio-specific rates
  input_audio?: number;
  output_audio?: number;
  // llm-metadata-specific
  per_image?: number;
  per_second?: number;
};

type RemoteModel = {
  id?: string;
  name?: string;
  cost?: RemoteCost;
};

type RemoteProvider = {
  id?: string;
  models?: Record<string, RemoteModel>;
};

type RemoteData = Record<string, RemoteProvider>;

/**
 * Fetch the remote pricing dataset for a source.
 */
async function fetchRemote(source: PricingSource): Promise<RemoteData> {
  const url = SOURCE_URLS[source];
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${source}: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as RemoteData;
}

/**
 * Resolve one of a model's names, under its first provider's type → the
 * remote pricing data's (providerId, modelId) pair.
 *
 * Most providers are listed under their own name, with the model by that
 * name as it is. Two exceptions:
 *   - `bedrock`  : listed as `amazon-bedrock`, by Bedrock's own id
 *                  (anthropic.claude-opus-4-5-20251101-v1:0).
 *   - `vertex`   : the modelId is `publisher/model`. Anthropic's go under
 *                  `google-vertex-anthropic` by the model alone; Google's
 *                  under `google-vertex` by the model alone; every other
 *                  publisher's under `google-vertex` by the whole id, as the
 *                  remote data names them (xai/grok-4.6).
 *
 * Both models.dev and llm-metadata use the same provider keys, so a single
 * mapping covers both sources.
 */
function resolveRemoteRef(
  type: ProviderType,
  modelId: string
): { providerId: string; modelId: string } {
  switch (type) {
    case 'bedrock':
      return { providerId: 'amazon-bedrock', modelId };
    case 'vertex': {
      const slash = modelId.indexOf('/');
      const publisher = slash > 0 ? modelId.slice(0, slash) : '';
      const name = modelId.slice(slash + 1);
      if (publisher === 'anthropic') {
        return { providerId: 'google-vertex-anthropic', modelId: name };
      }
      if (publisher === 'google') {
        return { providerId: 'google-vertex', modelId: name };
      }
      return { providerId: 'google-vertex', modelId };
    }
    case 'openai':
    case 'azure':
    case 'google':
    case 'anthropic':
    case 'xai':
    case 'deepseek':
      return { providerId: type, modelId };
  }
}

/**
 * A model's price in the source, under the first of its names the source
 * lists. A price belongs to the model, not to whichever provider serves it,
 * so it is looked up by the model's own id and then by its aliases, which
 * name the same model — never by the id a provider is sent.
 */
function findRemoteCost(
  data: RemoteData,
  type: ProviderType,
  names: string[]
): { cost: RemoteCost; providerId: string; modelId: string } | null {
  for (const name of names) {
    const ref = resolveRemoteRef(type, name);
    const listed = data[ref.providerId]?.models ?? {};
    // A model the source lists only under a version (claude-sonnet-4-6@default
    // for claude-sonnet-4-6) is found by it, when that version is the only one.
    const versions = Object.keys(listed).filter(key =>
      key.startsWith(`${ref.modelId}@`)
    );
    const key =
      ref.modelId in listed
        ? ref.modelId
        : versions.length === 1
          ? versions[0]
          : undefined;
    const cost = key ? listed[key]?.cost : undefined;
    if (key && cost) return { cost, providerId: ref.providerId, modelId: key };
  }
  return null;
}

/** Every name a model goes by: its id, then its aliases. */
const namesOf = (model: { modelId: string; aliases: string[] | null }) => [
  model.modelId,
  ...(model.aliases ?? [])
];

/**
 * Preview what would change for a given list of model.id values if synced.
 * Does not write to the database.
 */
export async function previewPricingSync(args: {
  source: PricingSource;
  modelDbIds?: string[]; // models.id (PK), not modelId
}): Promise<
  Array<{
    modelDbId: string;
    modelId: string;
    modelName: string;
    /** The model's first provider, by priority, whose listing the price is
     *  looked up in. Null for a model with none. */
    providerType: string | null;
    providerName: string | null;
    matched: boolean;
    remote: RemoteCost | null;
    current: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    } | null;
  }>
> {
  const data = await fetchRemote(args.source);

  const allModels = await db.query.models.findMany({
    where: args.modelDbIds?.length
      ? inArray(models.id, args.modelDbIds)
      : undefined,
    with: {
      pricings: { limit: 1 },
      // Priority order: the price is looked up in the first provider's
      // listing, whether or not it is on.
      providers: {
        with: { provider: true },
        orderBy: (binding, { asc }) => [asc(binding.priority), asc(binding.id)]
      }
    }
  });

  // One row per model, since a model has one price whichever provider serves
  // it.
  return allModels.map(m => {
    const current = m.pricings[0]
      ? {
          input: numOrUndef(m.pricings[0].input),
          output: numOrUndef(m.pricings[0].output),
          cacheRead: numOrUndef(m.pricings[0].cacheRead),
          cacheWrite: numOrUndef(m.pricings[0].cacheWrite)
        }
      : null;

    // A model with no provider still shows, as a row nothing can price.
    const first = m.providers[0]?.provider;
    const remote = first ? findRemoteCost(data, first.type, namesOf(m)) : null;
    return {
      modelDbId: m.id,
      modelId: m.modelId,
      modelName: m.name,
      providerType: first?.type ?? null,
      providerName: first?.name ?? null,
      matched: !!remote,
      remote: remote?.cost ?? null,
      current
    };
  });
}

/**
 * Sync prices from an external source for the given model IDs.
 *
 * For each model, look up remote cost and upsert the single pricing row
 * (one row per model — see schema).
 *
 * Returns counts of matched/updated/created/unchanged + list of unmatched ids.
 */
export async function runPricingSync(args: {
  source: PricingSource;
  modelDbIds?: string[]; // models.id (PK)
  onlyMissing?: boolean; // skip models that already have pricing
}): Promise<PricingSyncResult> {
  const data = await fetchRemote(args.source);
  const result: PricingSyncResult = {
    matched: 0,
    updated: 0,
    created: 0,
    unchanged: 0,
    notFound: [],
    skipped: []
  };

  const targets = await db.query.models.findMany({
    where: args.modelDbIds?.length
      ? inArray(models.id, args.modelDbIds)
      : undefined,
    with: {
      pricings: { limit: 1 },
      // Priority order: the price is looked up in the first provider's
      // listing, whether or not it is on — as the preview showed it.
      providers: {
        with: { provider: true },
        orderBy: (binding, { asc }) => [asc(binding.priority), asc(binding.id)]
      }
    }
  });

  for (const m of targets) {
    const type = m.providers[0]?.provider?.type as ProviderType | undefined;
    const remote = type ? findRemoteCost(data, type, namesOf(m)) : null;
    if (!remote) {
      result.notFound.push(m.modelId);
      continue;
    }
    result.matched += 1;

    const existing = m.pricings[0];
    if (existing && args.onlyMissing) {
      result.unchanged += 1;
      continue;
    }

    // A rate the source does not list is left as it is, not cleared. The
    // sources are partial — one may know a model's input price and not its
    // output — and the row may hold what an admin entered by hand; a sync that
    // wrote null over it took a working model out of service, since a chat
    // model with no output rate is refused at the gate.
    const kept = (
      remoteValue: number | undefined,
      key:
        | 'input'
        | 'output'
        | 'cacheRead'
        | 'cacheWrite'
        | 'reasoning'
        | 'image'
        | 'audioInput'
        | 'audioOutput'
    ): string | null => toNumeric(remoteValue) ?? existing?.[key] ?? null;

    const valuesToWrite = {
      modelId: m.modelId,
      input: kept(remote.cost.input, 'input'),
      output: kept(remote.cost.output, 'output'),
      // Cache R/W default to "0" (free) when neither the remote nor the row
      // has them, so the cost engine doesn't fall back to input rate.
      cacheRead: kept(remote.cost.cache_read, 'cacheRead') ?? '0',
      cacheWrite: kept(remote.cost.cache_write, 'cacheWrite') ?? '0',
      // Reasoning stays null when not provided — calc falls back to output rate.
      reasoning: kept(remote.cost.reasoning, 'reasoning'),
      image: kept(remote.cost.per_image, 'image'),
      // Token-based audio rates (gpt-4o-mini-tts, omni). Classic TTS bills per
      // character — the remote sources don't list a per-character rate, so
      // audioCharacters is configured manually (left untouched by sync).
      audioInput: kept(remote.cost.input_audio, 'audioInput'),
      audioOutput: kept(remote.cost.output_audio, 'audioOutput'),
      source: args.source,
      updatedAt: new Date()
    };

    // One case where what was there has to give way. An image model bills per
    // image or per token, never both, and which one is the provider's to say.
    // When the source names one style completely and only that one, it has
    // changed how the model is billed; keeping the other rate beside it would
    // make every sync from then on a conflict, skipped for ever, with the
    // model charged at a style its provider has dropped.
    if (m.capability === 'image') {
      const perToken =
        remote.cost.input !== undefined && remote.cost.output !== undefined;
      const perImage = remote.cost.per_image !== undefined;
      if (perToken && !perImage) valuesToWrite.image = null;
      if (perImage && !perToken) {
        valuesToWrite.input = null;
        valuesToWrite.output = null;
      }
    }

    // Keeping what was there can still leave a row priced two ways at once —
    // per image by hand, per token from the source. A model that works today
    // is not traded for one that does not: it is left alone and reported.
    if (existing) {
      const merged = { ...existing, ...valuesToWrite };
      const direction = { transcription: m.supportsTranscription ?? false };
      const worked =
        pricingMissingFields(m.capability, existing, direction).length === 0 &&
        !pricingStyleConflict(m.capability, existing);
      const conflict = pricingStyleConflict(m.capability, merged);
      const missing = pricingMissingFields(m.capability, merged, direction);

      if (worked && (conflict || missing.length > 0)) {
        result.skipped.push({
          modelId: m.modelId,
          reason: conflict ?? `Would be left without: ${missing.join(', ')}`
        });
        continue;
      }
    }

    if (existing) {
      // Numeric compare — DB stores "0.0010000000" but remote returns "0.001".
      // String equality would flag those as changed and trigger useless writes.
      const numEq = (a: string | null, b: string | null) =>
        parseNumber(a) === parseNumber(b);
      const changed =
        !numEq(valuesToWrite.input, existing.input) ||
        !numEq(valuesToWrite.output, existing.output) ||
        !numEq(valuesToWrite.cacheRead, existing.cacheRead) ||
        !numEq(valuesToWrite.cacheWrite, existing.cacheWrite) ||
        !numEq(valuesToWrite.reasoning, existing.reasoning) ||
        !numEq(valuesToWrite.image, existing.image) ||
        !numEq(valuesToWrite.audioInput, existing.audioInput) ||
        !numEq(valuesToWrite.audioOutput, existing.audioOutput) ||
        existing.source !== args.source;

      if (!changed) {
        result.unchanged += 1;
        continue;
      }

      await db
        .update(modelPricings)
        .set(valuesToWrite)
        .where(eq(modelPricings.id, existing.id));
      result.updated += 1;
    } else {
      await db.insert(modelPricings).values({
        id: generateUUID(),
        ...valuesToWrite,
        createdAt: new Date()
      });
      result.created += 1;
    }
  }

  return result;
}

/**
 * Search remote pricing data by free-text query (modelId substring).
 * Useful when admin wants to discover what a remote has.
 */
export async function searchRemotePricing(args: {
  source: PricingSource;
  query?: string;
  limit?: number;
}): Promise<
  Array<{
    providerId: string;
    modelId: string;
    name: string;
    cost: RemoteCost;
  }>
> {
  const data = await fetchRemote(args.source);
  const q = args.query?.toLowerCase().trim();
  const limit = args.limit ?? 50;
  const out: Array<{
    providerId: string;
    modelId: string;
    name: string;
    cost: RemoteCost;
  }> = [];

  for (const [providerId, provider] of Object.entries(data)) {
    if (!provider?.models) continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!model.cost) continue;
      if (q) {
        const hay = `${modelId} ${model.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({
        providerId,
        modelId,
        name: model.name ?? modelId,
        cost: model.cost
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const toNumeric = (n: number | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n) ? n.toString() : null;

const numOrUndef = (v: string | null): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
