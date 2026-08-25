import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { generateUUID } from '@/lib/utils';
import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { modelProviders, models } from '@/server/db/schema';

const capabilitySchema = z.enum(['chat', 'image', 'video', 'audio']);

export const modelRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z
        .object({
          capability: capabilitySchema.optional(),
          providerId: z.string().optional()
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return await ctx.db.query.models.findMany({
        where: and(
          input?.capability
            ? eq(models.capability, input.capability)
            : undefined,
          input?.providerId
            ? eq(models.providerId, input.providerId)
            : undefined
        ),
        orderBy: (models, { asc, desc }) => [
          asc(models.displayOrder),
          desc(models.createdAt)
        ],
        with: {
          provider: true,
          modelProviders: {
            with: { provider: true },
            orderBy: (mp, { asc }) => [asc(mp.priority)]
          }
        }
      });
    }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        modelId: z.string().min(1).max(255),
        // Legacy single provider (still accepted); prefer `providers`.
        providerId: z.string().min(1).optional(),
        providers: z
          .array(
            z.object({
              providerId: z.string().min(1),
              priority: z.number().int().optional(),
              isEnabled: z.boolean().optional()
            })
          )
          .optional(),
        capability: capabilitySchema,
        image: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        supportsVision: z.boolean().default(false),
        supportsReasoning: z.boolean().default(false),
        supportsImageEdit: z.boolean().default(false),
        supportsImageToVideo: z.boolean().default(false),
        supportsVideoEdit: z.boolean().default(false),
        supportsTranscription: z.boolean().default(false),
        isEnabled: z.boolean().default(true),
        uiOptions: z
          .object({
            size: z.string().optional(),
            sizes: z.array(z.string()).optional(),
            aspectRatio: z.string().optional(),
            aspectRatios: z.array(z.string()).optional(),
            duration: z.number().optional(),
            durations: z.array(z.number()).optional(),
            resolution: z.string().optional(),
            resolutions: z.array(z.string()).optional(),
            voice: z.string().optional(),
            voices: z.array(z.string()).optional(),
            reasoning: z.boolean().optional()
          })
          .strict()
          .optional(),
        apiParams: z
          .object({
            temperature: z.number().optional(),
            topP: z.number().optional(),
            topK: z.number().optional(),
            maxOutputTokens: z.number().optional(),
            frequencyPenalty: z.number().optional(),
            presencePenalty: z.number().optional()
          })
          .strict()
          .optional(),
        systemPrompt: z.string().nullable().optional(),
        displayOrder: z.number().int().default(0)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const normalizedModelId = input.modelId.trim();

      const bindings =
        input.providers && input.providers.length > 0
          ? input.providers
          : input.providerId
            ? [{ providerId: input.providerId }]
            : [];
      if (bindings.length === 0) {
        throw new Error('At least one provider is required');
      }
      const bindingProviderIds = bindings.map(b => b.providerId);
      if (new Set(bindingProviderIds).size !== bindingProviderIds.length) {
        throw new Error('A provider can only be added once per model');
      }
      // Mirror the first ENABLED binding (fall back to the first) so the legacy
      // providerId never points at a disabled binding.
      const primaryProviderId = (
        bindings.find(b => b.isEnabled !== false) ?? bindings[0]
      ).providerId;

      // modelId is globally unique (one logical model per row); the multiple
      // providers are attached via the model_providers table.
      const existingModel = await ctx.db.query.models.findFirst({
        where: eq(models.modelId, normalizedModelId)
      });
      if (existingModel) {
        throw new Error(
          'Model ID already exists; please choose a different Model ID'
        );
      }

      const id = generateUUID();
      await ctx.db.transaction(async tx => {
        await tx.insert(models).values({
          id,
          name: input.name,
          modelId: normalizedModelId,
          // Legacy mirror of the primary provider, kept in sync for compat.
          providerId: primaryProviderId,
          capability: input.capability,
          image: input.image,
          aliases: input.aliases,
          supportsVision: input.supportsVision,
          supportsReasoning: input.supportsReasoning,
          supportsImageEdit: input.supportsImageEdit,
          supportsImageToVideo: input.supportsImageToVideo,
          supportsVideoEdit: input.supportsVideoEdit,
          supportsTranscription: input.supportsTranscription,
          isEnabled: input.isEnabled,
          uiOptions: input.uiOptions,
          apiParams: input.apiParams,
          systemPrompt: input.systemPrompt,
          displayOrder: input.displayOrder
        });
        await tx.insert(modelProviders).values(
          bindings.map((b, index) => ({
            id: generateUUID(),
            modelId: normalizedModelId,
            providerId: b.providerId,
            priority: b.priority ?? index,
            isEnabled: b.isEnabled ?? true
          }))
        );
      });
      return { id };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        modelId: z.string().min(1).max(255).optional(),
        providerId: z.string().min(1).optional(),
        providers: z
          .array(
            z.object({
              providerId: z.string().min(1),
              priority: z.number().int().optional(),
              isEnabled: z.boolean().optional()
            })
          )
          .optional(),
        capability: capabilitySchema.optional(),
        image: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        supportsVision: z.boolean().optional(),
        supportsReasoning: z.boolean().optional(),
        supportsImageEdit: z.boolean().optional(),
        supportsImageToVideo: z.boolean().optional(),
        supportsVideoEdit: z.boolean().optional(),
        supportsTranscription: z.boolean().optional(),
        isEnabled: z.boolean().optional(),
        uiOptions: z
          .object({
            size: z.string().optional(),
            sizes: z.array(z.string()).optional(),
            aspectRatio: z.string().optional(),
            aspectRatios: z.array(z.string()).optional(),
            duration: z.number().optional(),
            durations: z.array(z.number()).optional(),
            resolution: z.string().optional(),
            resolutions: z.array(z.string()).optional(),
            voice: z.string().optional(),
            voices: z.array(z.string()).optional(),
            reasoning: z.boolean().optional()
          })
          .strict()
          .nullable()
          .optional(),
        apiParams: z
          .object({
            temperature: z.number().optional(),
            topP: z.number().optional(),
            topK: z.number().optional(),
            maxOutputTokens: z.number().optional(),
            frequencyPenalty: z.number().optional(),
            presencePenalty: z.number().optional()
          })
          .strict()
          .nullable()
          .optional(),
        systemPrompt: z.string().nullable().optional(),
        displayOrder: z.number().int().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, providers: inputProviders, ...updates } = input;
      const sanitizedUpdates = { ...updates };
      // modelId is the immutable business key — it's referenced by pricing /
      // usage / quota / settings and the model_providers FK, none of which
      // cascade on rename. Ignore any attempt to change it on update.
      delete sanitizedUpdates.modelId;

      const existingModel = await ctx.db.query.models.findFirst({
        where: eq(models.id, id)
      });
      if (!existingModel) {
        throw new Error('Model not found');
      }

      const targetModelId = existingModel.modelId;

      if (inputProviders && inputProviders.length > 0) {
        const ids = inputProviders.map(b => b.providerId);
        if (new Set(ids).size !== ids.length) {
          throw new Error('A provider can only be added once per model');
        }
      }

      // Keep the legacy providerId mirror aligned with the first ENABLED
      // binding (never a disabled one).
      const primaryProviderId =
        inputProviders && inputProviders.length > 0
          ? (
              inputProviders.find(b => b.isEnabled !== false) ??
              inputProviders[0]
            ).providerId
          : sanitizedUpdates.providerId;

      await ctx.db.transaction(async tx => {
        await tx
          .update(models)
          .set({
            ...sanitizedUpdates,
            ...(primaryProviderId ? { providerId: primaryProviderId } : {}),
            updatedAt: new Date()
          })
          .where(eq(models.id, id));

        // Replace provider bindings when an explicit list is supplied.
        if (inputProviders) {
          await tx
            .delete(modelProviders)
            .where(eq(modelProviders.modelId, targetModelId));
          if (inputProviders.length > 0) {
            await tx.insert(modelProviders).values(
              inputProviders.map((b, index) => ({
                id: generateUUID(),
                modelId: targetModelId,
                providerId: b.providerId,
                priority: b.priority ?? index,
                isEnabled: b.isEnabled ?? true
              }))
            );
          }
        }
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(models).where(eq(models.id, input.id));
    }),

  toggleEnabled: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        isEnabled: z.boolean()
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(models)
        .set({ isEnabled: input.isEnabled, updatedAt: new Date() })
        .where(eq(models.id, input.id));
    })
});
