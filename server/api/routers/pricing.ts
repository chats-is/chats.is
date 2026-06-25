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
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { modelPricings, models } from '@/server/db/schema';

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

export const pricingRouter = createTRPCRouter({
  /**
   * List all models together with their pricing (one row per model).
   * Convenient for the admin pricing table.
   */
  listWithModels: adminProcedure
    .input(
      z
        .object({
          capability: z.enum(['chat', 'image', 'video', 'audio']).optional(),
          providerId: z.string().optional()
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.query.models.findMany({
        where: and(
          input?.capability
            ? eq(models.capability, input.capability)
            : undefined,
          input?.providerId
            ? eq(models.providerId, input.providerId)
            : undefined
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
    }),

  /**
   * Create or update the pricing for a model. One row per model.
   */
  upsert: adminProcedure
    .input(
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
    .mutation(async ({ ctx, input }) => {
      const model = await ctx.db.query.models.findFirst({
        where: eq(models.id, input.modelDbId)
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
        input.image != null &&
        (input.input != null || input.output != null)
      ) {
        throw new Error(
          'Image pricing must be either Per image OR token-based (Input + Output), not both.'
        );
      }

      // Audio is one-of-three: per-character (classic TTS), per-token, or
      // per-second (STT).
      const audioStyles = [
        input.audioCharacters != null,
        input.audioInput != null || input.audioOutput != null,
        input.audioSeconds != null
      ].filter(Boolean).length;
      if (cap === 'audio' && audioStyles > 1) {
        throw new Error(
          'Audio pricing must be exactly one style: Per 1M characters, token-based (Audio input / output), or Per second.'
        );
      }

      // Video is the same either/or: per-video (flat) OR per-second.
      if (
        cap === 'video' &&
        input.video != null &&
        input.videoSeconds != null
      ) {
        throw new Error(
          'Video pricing must be either Per video OR Per second, not both.'
        );
      }

      const missing = pricingMissingFields(
        cap,
        input as unknown as PricingRecord,
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
      // never falls back to input rate. All other fields stay null when unset.
      const cacheDefault = (v: string | null | undefined): string =>
        v === null || v === undefined || v === '' ? '0' : v;
      const values = {
        modelId: model.modelId,
        input: input.input,
        output: input.output,
        cacheRead: cacheDefault(input.cacheRead),
        cacheWrite: cacheDefault(input.cacheWrite),
        // Reasoning stays null when not set — cost engine falls back to output.
        reasoning: input.reasoning,
        image: input.image,
        video: input.video,
        videoSeconds: input.videoSeconds,
        audioInput: input.audioInput,
        audioOutput: input.audioOutput,
        audioCharacters: input.audioCharacters,
        audioSeconds: input.audioSeconds,
        source: input.source,
        updatedAt: now
      };

      const existing = await ctx.db.query.modelPricings.findFirst({
        where: eq(modelPricings.modelId, model.modelId)
      });
      if (existing) {
        await ctx.db
          .update(modelPricings)
          .set(values)
          .where(eq(modelPricings.id, existing.id));
      } else {
        await ctx.db.insert(modelPricings).values({
          id: generateUUID(),
          ...values,
          createdAt: now
        });
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(modelPricings).where(eq(modelPricings.id, input.id));
    }),

  /**
   * Preview what would change if we synced pricing from a remote source.
   */
  previewSync: adminProcedure
    .input(
      z.object({
        source: syncSourceSchema,
        modelDbIds: z.array(z.string()).optional()
      })
    )
    .mutation(async ({ input }) => {
      return await previewSync({
        source: input.source as PricingSource,
        modelDbIds: input.modelDbIds
      });
    }),

  /**
   * Sync pricing from a remote source. If modelDbIds is omitted, syncs all
   * models. onlyMissing=true skips models that already have active pricing.
   */
  sync: adminProcedure
    .input(
      z.object({
        source: syncSourceSchema,
        modelDbIds: z.array(z.string()).optional(),
        onlyMissing: z.boolean().default(false)
      })
    )
    .mutation(async ({ input }) => {
      return await syncPricing({
        source: input.source as PricingSource,
        modelDbIds: input.modelDbIds,
        onlyMissing: input.onlyMissing
      });
    }),

  /**
   * Search remote pricing catalog by free-text query.
   * Useful for admin UI autocomplete.
   */
  searchRemote: adminProcedure
    .input(
      z.object({
        source: syncSourceSchema,
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50)
      })
    )
    .query(async ({ input }) => {
      return await searchRemotePricing({
        source: input.source as PricingSource,
        query: input.query,
        limit: input.limit
      });
    })
});
