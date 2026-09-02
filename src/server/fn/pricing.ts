import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { PricingRecord, PricingSource } from '@/types';
import { pricingMissingFields } from '@/lib/pricing';
import {
  previewSync,
  searchRemotePricing,
  syncPricing
} from '@/lib/pricing-sync';
import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { modelPricings, models } from '@/server/db/schema';
import { adminMiddleware } from '@/server/middleware';

const sourceSchema = z.enum(['manual', 'models.dev', 'llm-metadata']);
const syncSourceSchema = z.enum(['models.dev', 'llm-metadata']);

const priceNumberSchema = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform(v => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toString();
  });

/**
 * List all models together with their pricing (one row per model).
 * Convenient for the admin pricing table.
 */
export const listPricingWithModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      capability: z.enum(['chat', 'image', 'video', 'audio']).optional(),
      providerId: z.string().optional()
    })
  )
  .handler(async ({ data }) => {
    const result = await db.query.models.findMany({
      where: and(
        data.capability ? eq(models.capability, data.capability) : undefined,
        data.providerId ? eq(models.providerId, data.providerId) : undefined
      ),
      with: {
        provider: true,
        pricings: { limit: 1 }
      },
      orderBy: (m, { asc, desc }) => [asc(m.displayOrder), desc(m.createdAt)]
    });
    return result.map(m => ({
      ...m,
      pricing: m.pricings[0] ?? null
    }));
  });

/**
 * Create or update the pricing for a model. One row per model.
 */
export const upsertPricing = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      modelDbId: z.string().min(1),
      input: priceNumberSchema,
      output: priceNumberSchema,
      cacheRead: priceNumberSchema,
      cacheWrite: priceNumberSchema,
      reasoning: priceNumberSchema,
      image: priceNumberSchema,
      video: priceNumberSchema,
      videoSeconds: priceNumberSchema,
      audioInput: priceNumberSchema,
      audioOutput: priceNumberSchema,
      audioCharacters: priceNumberSchema,
      audioSeconds: priceNumberSchema,
      source: sourceSchema.default('manual')
    })
  )
  .handler(async ({ data }) => {
    const model = await db.query.models.findFirst({
      where: eq(models.id, data.modelDbId)
    });
    if (!model) throw new Error('Model not found');

    // Capability-aware required-field check. Cache R/W are auto-defaulted
    // to 0 below, so they don't need to be in the required list. Reuses
    // `pricingMissingFields` from lib/pricing so admin-side and runtime
    // gate share the same rule.
    const cap = model.capability as 'chat' | 'image' | 'video' | 'audio';

    // Image models bill EITHER per-image OR per-token, never both — the two
    // styles are mutually exclusive (see calculateImageCost).
    if (
      cap === 'image' &&
      data.image != null &&
      (data.input != null || data.output != null)
    ) {
      throw new Error(
        'Image pricing must be either Per image OR token-based (Input + Output), not both.'
      );
    }

    // Audio is one-of-three: per-character (classic TTS), per-token, or
    // per-second (STT).
    const audioStyles = [
      data.audioCharacters != null,
      data.audioInput != null || data.audioOutput != null,
      data.audioSeconds != null
    ].filter(Boolean).length;
    if (cap === 'audio' && audioStyles > 1) {
      throw new Error(
        'Audio pricing must be exactly one style: Per 1M characters, token-based (Audio data / output), or Per second.'
      );
    }

    // Video is the same either/or: per-video (flat) OR per-second.
    if (cap === 'video' && data.video != null && data.videoSeconds != null) {
      throw new Error(
        'Video pricing must be either Per video OR Per second, not both.'
      );
    }

    const missing = pricingMissingFields(
      cap,
      data as unknown as PricingRecord,
      cap === 'audio'
        ? { transcription: !!model.supportsTranscription }
        : undefined
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required price${missing.length > 1 ? 's' : ''} for ${cap} model: ${missing.join(', ')}.`
      );
    }

    const now = new Date();
    // Cache R/W default to "0" (free) when not set, so the cost engine
    // never falls back to data rate. All other fields stay null when unset.
    const cacheDefault = (v: string | null | undefined): string =>
      v === null || v === undefined || v === '' ? '0' : v;
    const values = {
      modelId: model.modelId,
      input: data.input,
      output: data.output,
      cacheRead: cacheDefault(data.cacheRead),
      cacheWrite: cacheDefault(data.cacheWrite),
      // Reasoning stays null when not set — cost engine falls back to output.
      reasoning: data.reasoning,
      image: data.image,
      video: data.video,
      videoSeconds: data.videoSeconds,
      audioInput: data.audioInput,
      audioOutput: data.audioOutput,
      audioCharacters: data.audioCharacters,
      audioSeconds: data.audioSeconds,
      source: data.source,
      updatedAt: now
    };

    const existing = await db.query.modelPricings.findFirst({
      where: eq(modelPricings.modelId, model.modelId)
    });
    if (existing) {
      await db
        .update(modelPricings)
        .set(values)
        .where(eq(modelPricings.id, existing.id));
    } else {
      await db.insert(modelPricings).values({
        id: generateUUID(),
        ...values,
        createdAt: now
      });
    }
  });

export const deletePricing = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await db.delete(modelPricings).where(eq(modelPricings.id, data.id));
  });

/**
 * Preview what would change if we synced pricing from a remote source.
 */
export const previewPricingSync = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      source: syncSourceSchema,
      modelDbIds: z.array(z.string()).optional()
    })
  )
  .handler(async ({ data }) => {
    return await previewSync({
      source: data.source as PricingSource,
      modelDbIds: data.modelDbIds
    });
  });

/**
 * Sync pricing from a remote source. If modelDbIds is omitted, syncs all
 * models. onlyMissing=true skips models that already have active pricing.
 */
export const runPricingSync = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      source: syncSourceSchema,
      modelDbIds: z.array(z.string()).optional(),
      onlyMissing: z.boolean().default(false)
    })
  )
  .handler(async ({ data }) => {
    return await syncPricing({
      source: data.source as PricingSource,
      modelDbIds: data.modelDbIds,
      onlyMissing: data.onlyMissing
    });
  });

/**
 * Search remote pricing catalog by free-text query.
 * Useful for admin UI autocomplete.
 */
export const searchRemotePricingFn = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      source: syncSourceSchema,
      query: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50)
    })
  )
  .handler(async ({ data }) => {
    return await searchRemotePricing({
      source: data.source as PricingSource,
      query: data.query,
      limit: data.limit
    });
  });

export const pricingQueries = {
  all: () => ['pricing'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    listWithModels: () => ['pricing', 'listWithModels'] as const,
    searchRemote: () => ['pricing', 'searchRemote'] as const
  },
  listWithModels: (
    input: {
      capability?: 'chat' | 'image' | 'video' | 'audio';
      providerId?: string;
    } = {}
  ) =>
    queryOptions({
      queryKey: [...pricingQueries.key.listWithModels(), input] as const,
      queryFn: () => listPricingWithModels({ data: input })
    }),
  /** Reads the upstream catalogue, so it is only fetched when asked for. */
  searchRemote: (input: {
    source: 'models.dev' | 'llm-metadata';
    query?: string;
    limit?: number;
  }) =>
    queryOptions({
      queryKey: [...pricingQueries.key.searchRemote(), input] as const,
      queryFn: () => searchRemotePricingFn({ data: { limit: 50, ...input } })
    })
};
