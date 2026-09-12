import '@tanstack/react-start/server-only';

import { and, eq } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type modelCreateSchema,
  type modelListSchema,
  type modelUpdateSchema
} from '@/types/model';
import { perRequest } from '@/lib/request-cache';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { modelProviders, models, type providers } from '@/db/schema';
import { PublicError } from '@/server/public-error';

type Provider = typeof providers.$inferSelect;
type ProviderBinding = typeof modelProviders.$inferSelect & {
  provider: Provider | null;
};
type Model = typeof models.$inferSelect & {
  /** @deprecated highest-priority provider, kept for legacy callers. */
  provider: Provider | null;
  /** Priority-ordered, enabled provider bindings for failover. */
  providers: ProviderBinding[];
};

/**
 * Every enabled model with its usable provider bindings.
 *
 * Exported only because the settings service assembles the console's model
 * lists from it — it was private while both lived in one file.
 */
export const getAllModels = perRequest(
  'getAllModels',
  async (): Promise<Model[]> => {
    const result = await db.query.models.findMany({
      where: eq(models.isEnabled, true),
      with: {
        provider: true,
        modelProviders: {
          with: { provider: true }
        }
      },
      orderBy: (models, { asc }) => [asc(models.displayOrder)]
    });

    return result
      .map(m => {
        const hasBindings = (m.modelProviders ?? []).length > 0;
        // New path: enabled bindings ordered by priority (provider also enabled).
        const bindings = (m.modelProviders ?? [])
          .filter(b => b.isEnabled && b.provider?.isEnabled)
          .sort((a, b) => a.priority - b.priority);

        // Backward-compat fallback ONLY when the model has no binding rows yet
        // (pre-migration). A model that HAS bindings but all are disabled stays
        // unavailable — we must not resurrect a provider the admin disabled.
        const providersList: ProviderBinding[] = hasBindings
          ? bindings
          : m.provider?.isEnabled
            ? [
                {
                  id: `legacy:${m.id}`,
                  modelId: m.modelId,
                  providerId: m.providerId,
                  priority: 0,
                  isEnabled: true,
                  createdAt: m.createdAt,
                  updatedAt: m.updatedAt,
                  provider: m.provider
                }
              ]
            : [];

        return {
          ...m,
          provider: providersList[0]?.provider ?? m.provider ?? null,
          providers: providersList
        };
      })
      .filter(m => m.providers.length > 0);
  }
);

export const findModelByModelId = perRequest(
  'findModelByModelId',
  async (
    modelId: string,
    capability?: 'chat' | 'image' | 'video' | 'audio'
  ): Promise<Model | undefined> => {
    const allModels = await getAllModels();

    return allModels.find(m => {
      if (capability && m.capability !== capability) return false;
      const aliases = m.aliases;
      return m.modelId === modelId || aliases?.includes(modelId);
    });
  }
);

// ============================================================================
// Admin CRUD
// ============================================================================

/** Models with their provider bindings, for the console's model table. */
export async function listModels(filter: z.infer<typeof modelListSchema>) {
  return await db.query.models.findMany({
    where: and(
      filter.capability ? eq(models.capability, filter.capability) : undefined,
      filter.providerId ? eq(models.providerId, filter.providerId) : undefined
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
}

export async function createModel(input: z.infer<typeof modelCreateSchema>) {
  const normalizedModelId = input.modelId.trim();

  const bindings =
    input.providers && input.providers.length > 0
      ? input.providers
      : input.providerId
        ? [{ providerId: input.providerId }]
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
}

export async function updateModel(input: z.infer<typeof modelUpdateSchema>) {
  const { id, providers: inputProviders, ...updates } = input;
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
}

export async function deleteModel(id: string) {
  await db.delete(models).where(eq(models.id, id));
}

export async function toggleEnabledModel(id: string, isEnabled: boolean) {
  await db
    .update(models)
    .set({ isEnabled: isEnabled, updatedAt: new Date() })
    .where(eq(models.id, id));
}
