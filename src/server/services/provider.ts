import '@tanstack/react-start/server-only';

import { and, count, eq, ilike, inArray, or } from 'drizzle-orm';
import { type z } from 'zod';

import { type VertexServiceAccountKey } from '@/types';
import { type modelSyncSchema } from '@/types/model';
import { pageWindow } from '@/types/pagination';
import {
  type providerCreateSchema,
  type providerListSchema,
  type providerUpdateSchema
} from '@/types/provider';
import { decrypt, encrypt, maskedKey } from '@/lib/crypto';
import { getProviderModels, toProviderModelId } from '@/lib/provider';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { modelProviders, models, providers } from '@/db/schema';
import { PublicError } from '@/server/public-error';

/** The console's provider table: one page of providers with their models,
 *  API keys masked. */
export async function listProviders(
  filter: z.infer<typeof providerListSchema>
) {
  const search = filter.q?.trim();
  const term = search ? `%${search}%` : null;
  const where = term
    ? or(ilike(providers.name, term), ilike(providers.type, term))
    : undefined;

  const [result, [totalRow]] = await Promise.all([
    db.query.providers.findMany({
      where,
      ...pageWindow(filter),
      // `id` last so the order is total — see the note on `listModels`.
      orderBy: (providers, { asc, desc }) => [
        asc(providers.displayOrder),
        desc(providers.createdAt),
        asc(providers.id)
      ]
    }),
    db.select({ count: count() }).from(providers).where(where)
  ]);

  return {
    rows: result.map(({ apiKey, ...provider }) => ({
      ...provider,
      maskedKey: maskedKey(provider.type, apiKey)
    })),
    total: Number(totalRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/**
 * Every provider, for the selectors that offer one.
 *
 * Unpaged, like the model selector's list, and without the key or the models
 * relation — a provider picker reads only the identity it shows.
 */
export async function listProvidersForSelect() {
  return await db.query.providers.findMany({
    orderBy: (providers, { asc, desc }) => [
      asc(providers.displayOrder),
      desc(providers.createdAt)
    ],
    columns: { id: true, name: true, type: true, isEnabled: true, image: true }
  });
}

export async function createProvider(
  input: z.infer<typeof providerCreateSchema>
) {
  const id = generateUUID();

  await db.insert(providers).values({
    id,
    name: input.name,
    type: input.type,
    apiKey: encrypt(input.apiKey.trim()),
    image: input.image,
    baseUrl: input.baseUrl || null,
    isEnabled: input.isEnabled,
    apiOptions: input.apiOptions,
    displayOrder: input.displayOrder
  });
  return { id };
}

export async function updateProvider(
  input: z.infer<typeof providerUpdateSchema>
) {
  const existingProvider = await db.query.providers.findFirst({
    where: eq(providers.id, input.id)
  });

  if (!existingProvider) {
    throw new PublicError('Provider not found');
  }

  const { id, apiKey, apiOptions, baseUrl, ...updates } = input;
  let resolvedApiKey = apiKey;

  if (input.type === 'vertex' && apiKey) {
    let vertexKey: VertexServiceAccountKey | null = null;

    try {
      vertexKey = JSON.parse(apiKey) as VertexServiceAccountKey;
    } catch {}

    if (vertexKey?.location && !vertexKey.credentials) {
      const existingApiKey = existingProvider.apiKey
        ? decrypt(existingProvider.apiKey)
        : undefined;
      let existingVertexKey: VertexServiceAccountKey | null = null;

      if (existingApiKey) {
        try {
          existingVertexKey = JSON.parse(
            existingApiKey
          ) as VertexServiceAccountKey;
        } catch {}
      }

      if (existingVertexKey?.credentials) {
        resolvedApiKey = JSON.stringify({
          location: vertexKey.location,
          credentials: existingVertexKey.credentials
        });
      } else {
        throw new PublicError('Invalid existing Google Vertex AI credentials');
      }
    }
  }

  await db
    .update(providers)
    .set({
      ...updates,
      ...(resolvedApiKey && {
        apiKey: encrypt(resolvedApiKey.trim())
      }),
      ...(baseUrl !== undefined && { baseUrl: baseUrl || null }),
      ...(apiOptions !== undefined && { apiOptions }),
      updatedAt: new Date()
    })
    .where(eq(providers.id, id));
}

export async function deleteProvider(id: string) {
  // This will fail if provider has models due to FK constraint
  await db.delete(providers).where(eq(providers.id, id));
}

export async function toggleEnabledProvider(id: string, isEnabled: boolean) {
  await db
    .update(providers)
    .set({ isEnabled: isEnabled, updatedAt: new Date() })
    .where(eq(providers.id, id));
}

/** What the provider's own API offers, marked with what this install
 *  already has. Reaches the provider over the network. */
export async function fetchProviderModels(providerId: string) {
  const provider = await db.query.providers.findFirst({
    where: eq(providers.id, providerId)
  });

  if (!provider) {
    throw new PublicError('Provider not found');
  }

  const apiModelIds = await getProviderModels(provider);
  // Every model this installation has, not only the ones already paired with
  // this provider: `model_id` is unique across the table, so one that exists
  // under another provider cannot be created again here either. Asking only
  // about this provider's pairings offered it as new and failed on submit.
  const existing = await db.query.models.findMany({
    columns: { modelId: true },
    where: inArray(models.modelId, apiModelIds)
  });
  const existingIds = new Set(existing.map(model => model.modelId));

  return apiModelIds.map(modelId => ({
    modelId,
    name: modelId,
    exists: existingIds.has(modelId)
  }));
}

/** Enabled providers whose API actually offers this model — the same-kind
 *  providers it can fail over between. One whose listing errors is omitted. */
export async function compatibleProviders(modelId: string) {
  const enabledProviders = await db.query.providers.findMany({
    where: eq(providers.isEnabled, true),
    orderBy: (providers, { asc, desc }) => [
      asc(providers.displayOrder),
      desc(providers.createdAt)
    ]
  });

  const checks = await Promise.all(
    enabledProviders.map(async provider => {
      try {
        const ids = await getProviderModels(provider);
        // Vertex/Bedrock list models under their renamed ids — compare
        // against the upstream id the provider would actually receive.
        const target = toProviderModelId(provider.type, modelId);
        return ids.includes(target) || ids.includes(modelId)
          ? { id: provider.id, name: provider.name }
          : null;
      } catch {
        return null;
      }
    })
  );

  return checks.filter((p): p is { id: string; name: string } => p !== null);
}

/** Create the selected models this install does not have yet, and report
 *  how many were skipped for already existing. */
export async function syncProviderModels(
  input: z.infer<typeof modelSyncSchema>
) {
  const provider = await db.query.providers.findFirst({
    where: eq(providers.id, input.providerId)
  });

  if (!provider) {
    throw new PublicError('Provider not found');
  }

  if (input.items.length === 0) {
    throw new PublicError('No models selected');
  }

  const existingBindings = await db.query.modelProviders.findMany({
    where: and(
      eq(modelProviders.providerId, input.providerId),
      inArray(
        modelProviders.modelId,
        input.items.map(model => model.modelId)
      )
    )
  });
  const existingIds = new Set(existingBindings.map(binding => binding.modelId));
  const modelsToCreate = input.items.filter(
    model => !existingIds.has(model.modelId)
  );

  if (modelsToCreate.length > 0) {
    // The binding is the model's only link to a provider, so it is written in
    // the same transaction: a model without one is a model nothing can serve.
    await db.transaction(async tx => {
      await tx.insert(models).values(
        modelsToCreate.map(model => ({
          id: generateUUID(),
          name: model.modelId,
          modelId: model.modelId,
          capability: model.capability,
          supportsVision: false,
          supportsReasoning: false,
          isEnabled: true,
          displayOrder: 0
        }))
      );
      await tx.insert(modelProviders).values(
        modelsToCreate.map(model => ({
          id: generateUUID(),
          modelId: model.modelId,
          providerId: input.providerId,
          priority: 0,
          isEnabled: true
        }))
      );
    });
  }

  return {
    created: modelsToCreate.length,
    skipped: input.items.length - modelsToCreate.length
  };
}
