import '@tanstack/react-start/server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { type z } from 'zod';

import { type VertexServiceAccountKey } from '@/types';
import { type modelSyncSchema } from '@/types/model';
import {
  type providerCreateSchema,
  type providerUpdateSchema
} from '@/types/provider';
import { decrypt, encrypt, maskedKey } from '@/lib/crypto';
import { getProviderModels, toProviderModelId } from '@/lib/provider';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { models, providers } from '@/db/schema';
import { PublicError } from '@/server/public-error';

/** Providers with their models, API keys masked. */
export async function listProviders() {
  const result = await db.query.providers.findMany({
    orderBy: (providers, { asc, desc }) => [
      asc(providers.displayOrder),
      desc(providers.createdAt)
    ],
    with: {
      models: true
    }
  });
  return result.map(({ apiKey, ...provider }) => ({
    ...provider,
    maskedKey: maskedKey(provider.type, apiKey)
  }));
}

/** The enabled providers, without the key column at all. */
export async function listEnabledProviders() {
  return await db.query.providers.findMany({
    where: eq(providers.isEnabled, true),
    orderBy: (providers, { asc, desc }) => [
      asc(providers.displayOrder),
      desc(providers.createdAt)
    ],
    columns: {
      apiKey: false // Mask API key for public access
    }
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
    where: eq(providers.id, providerId),
    with: {
      models: true
    }
  });

  if (!provider) {
    throw new PublicError('Provider not found');
  }

  const apiModelIds = await getProviderModels(provider);
  const existingIds = new Set(provider.models.map(model => model.modelId));

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

  const existingModels = await db.query.models.findMany({
    where: and(
      eq(models.providerId, input.providerId),
      inArray(
        models.modelId,
        input.items.map(model => model.modelId)
      )
    )
  });
  const existingIds = new Set(existingModels.map(model => model.modelId));
  const modelsToCreate = input.items.filter(
    model => !existingIds.has(model.modelId)
  );

  if (modelsToCreate.length > 0) {
    await db.insert(models).values(
      modelsToCreate.map(model => ({
        id: generateUUID(),
        name: model.modelId,
        modelId: model.modelId,
        providerId: input.providerId,
        capability: model.capability,
        supportsVision: false,
        supportsReasoning: false,
        isEnabled: true,
        displayOrder: 0
      }))
    );
  }

  return {
    created: modelsToCreate.length,
    skipped: input.items.length - modelsToCreate.length
  };
}
