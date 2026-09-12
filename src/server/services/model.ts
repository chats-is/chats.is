import '@tanstack/react-start/server-only';

import { eq } from 'drizzle-orm';

import { perRequest } from '@/lib/request-cache';
import { db } from '@/db';
import { models, type modelProviders, type providers } from '@/db/schema';

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
