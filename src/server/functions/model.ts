import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq } from 'drizzle-orm';

import {
  modelCreateSchema,
  modelIdSchema,
  modelListSchema,
  modelToggleSchema,
  modelUpdateSchema
} from '@/types/model';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { modelProviders, models } from '@/db/schema';
import { adminMiddleware } from '@/server/middleware';
import { PublicError } from '@/server/public-error';

export const listModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(modelListSchema)
  .handler(async ({ data }) => {
    return await db.query.models.findMany({
      where: and(
        data.capability ? eq(models.capability, data.capability) : undefined,
        data.providerId ? eq(models.providerId, data.providerId) : undefined
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
  });

export const createModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelCreateSchema)
  .handler(async ({ data }) => {
    const normalizedModelId = data.modelId.trim();

    const bindings =
      data.providers && data.providers.length > 0
        ? data.providers
        : data.providerId
          ? [{ providerId: data.providerId }]
          : [];
    if (bindings.length === 0) {
      throw new PublicError('At least one provider is required');
    }
    const bindingProviderIds = bindings.map(b => b.providerId);
    if (new Set(bindingProviderIds).size !== bindingProviderIds.length) {
      throw new PublicError('A provider can only be added once per model');
    }
    // Mirror the first ENABLED binding (fall back to the first) so the legacy
    // providerId never points at a disabled binding.
    const primaryProviderId = (
      bindings.find(b => b.isEnabled !== false) ?? bindings[0]
    ).providerId;

    // modelId is globally unique (one logical model per row); the multiple
    // providers are attached via the model_providers table.
    const existingModel = await db.query.models.findFirst({
      where: eq(models.modelId, normalizedModelId)
    });
    if (existingModel) {
      throw new PublicError(
        'Model ID already exists; please choose a different Model ID'
      );
    }

    const id = generateUUID();
    await db.transaction(async tx => {
      await tx.insert(models).values({
        id,
        name: data.name,
        modelId: normalizedModelId,
        // Legacy mirror of the primary provider, kept in sync for compat.
        providerId: primaryProviderId,
        capability: data.capability,
        image: data.image,
        aliases: data.aliases,
        supportsVision: data.supportsVision,
        supportsReasoning: data.supportsReasoning,
        supportsImageEdit: data.supportsImageEdit,
        supportsImageToVideo: data.supportsImageToVideo,
        supportsVideoEdit: data.supportsVideoEdit,
        supportsTranscription: data.supportsTranscription,
        isEnabled: data.isEnabled,
        uiOptions: data.uiOptions,
        apiParams: data.apiParams,
        systemPrompt: data.systemPrompt,
        displayOrder: data.displayOrder
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
  });

export const updateModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelUpdateSchema)
  .handler(async ({ data }) => {
    const { id, providers: inputProviders, ...updates } = data;
    const sanitizedUpdates = { ...updates };
    // modelId is the immutable business key — it's referenced by pricing /
    // usage / quota / settings and the model_providers FK, none of which
    // cascade on rename. Ignore any attempt to change it on update.
    delete sanitizedUpdates.modelId;

    const existingModel = await db.query.models.findFirst({
      where: eq(models.id, id)
    });
    if (!existingModel) {
      throw new PublicError('Model not found');
    }

    const targetModelId = existingModel.modelId;

    if (inputProviders && inputProviders.length > 0) {
      const ids = inputProviders.map(b => b.providerId);
      if (new Set(ids).size !== ids.length) {
        throw new PublicError('A provider can only be added once per model');
      }
    }

    // Keep the legacy providerId mirror aligned with the first ENABLED
    // binding (never a disabled one).
    const primaryProviderId =
      inputProviders && inputProviders.length > 0
        ? (inputProviders.find(b => b.isEnabled !== false) ?? inputProviders[0])
            .providerId
        : sanitizedUpdates.providerId;

    await db.transaction(async tx => {
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
  });

export const deleteModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelIdSchema)
  .handler(async ({ data }) => {
    await db.delete(models).where(eq(models.id, data.id));
  });

export const toggleEnabledModel = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(modelToggleSchema)
  .handler(async ({ data }) => {
    await db
      .update(models)
      .set({ isEnabled: data.isEnabled, updatedAt: new Date() })
      .where(eq(models.id, data.id));
  });

export const modelQueries = {
  all: () => ['model'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['model', 'list'] as const
  },
  list: (
    input: {
      capability?: 'chat' | 'image' | 'video' | 'audio';
      providerId?: string;
    } = {}
  ) =>
    queryOptions({
      queryKey: [...modelQueries.key.list(), input] as const,
      queryFn: () => listModels({ data: input })
    })
};
