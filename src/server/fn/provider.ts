import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { type VertexServiceAccountKey } from '@/types';
import { decrypt, encrypt, maskedKey } from '@/lib/crypto';
import { getProviderModels, toProviderModelId } from '@/lib/provider';
import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { models, providers } from '@/server/db/schema';
import { adminMiddleware } from '@/server/middleware';
import { PublicError } from '@/server/public-error';

export const listProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
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
  });

export const listEnabledProviders = createServerFn({ method: 'GET' }).handler(
  async () => {
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
);

export const createProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(100),
      type: z.enum([
        'openai',
        'azure',
        'google',
        'vertex',
        'anthropic',
        'bedrock',
        'xai',
        'deepseek'
      ]),
      apiKey: z.string().min(1),
      image: z.string().optional(),
      baseUrl: z.url().optional().or(z.literal('')),
      isEnabled: z.boolean().default(false),
      apiOptions: z.record(z.string(), z.any()).optional(),
      displayOrder: z.number().int().default(0)
    })
  )
  .handler(async ({ data }) => {
    const id = generateUUID();

    await db.insert(providers).values({
      id,
      name: data.name,
      type: data.type,
      apiKey: encrypt(data.apiKey.trim()),
      image: data.image,
      baseUrl: data.baseUrl || null,
      isEnabled: data.isEnabled,
      apiOptions: data.apiOptions,
      displayOrder: data.displayOrder
    });
    return { id };
  });

export const updateProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(100).optional(),
      type: z.enum([
        'openai',
        'azure',
        'google',
        'vertex',
        'anthropic',
        'bedrock',
        'xai',
        'deepseek'
      ]),
      apiKey: z.string().optional(),
      image: z.string().optional(),
      baseUrl: z.url().optional().or(z.literal('')),
      isEnabled: z.boolean().optional(),
      apiOptions: z.record(z.string(), z.any()).nullable().optional(),
      displayOrder: z.number().int().optional()
    })
  )
  .handler(async ({ data }) => {
    const existingProvider = await db.query.providers.findFirst({
      where: eq(providers.id, data.id)
    });

    if (!existingProvider) {
      throw new PublicError('Provider not found');
    }

    const { id, apiKey, apiOptions, baseUrl, ...updates } = data;
    let resolvedApiKey = apiKey;

    if (data.type === 'vertex' && apiKey) {
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
          throw new PublicError(
            'Invalid existing Google Vertex AI credentials'
          );
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
  });

export const deleteProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    // This will fail if provider has models due to FK constraint
    await db.delete(providers).where(eq(providers.id, data.id));
  });

export const toggleEnabledProvider = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id: z.string().min(1),
      isEnabled: z.boolean()
    })
  )
  .handler(async ({ data }) => {
    await db
      .update(providers)
      .set({ isEnabled: data.isEnabled, updatedAt: new Date() })
      .where(eq(providers.id, data.id));
  });

export const fetchProviderModels = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(z.object({ providerId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, data.providerId),
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
  });

// Enabled providers whose API actually offers the given modelId — i.e. the
// "same-kind" providers a model can fail over between. Providers whose model
// listing errors are omitted.
export const compatibleProviders = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .validator(z.object({ modelId: z.string().min(1) }))
  .handler(async ({ data }) => {
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
          const target = toProviderModelId(provider.type, data.modelId);
          return ids.includes(target) || ids.includes(data.modelId)
            ? { id: provider.id, name: provider.name }
            : null;
        } catch {
          return null;
        }
      })
    );

    return checks.filter((p): p is { id: string; name: string } => p !== null);
  });

export const syncProviderModels = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      providerId: z.string().min(1),
      items: z
        .array(
          z.object({
            modelId: z.string().min(1).max(255),
            capability: z.enum(['chat', 'image', 'video', 'audio'])
          })
        )
        .min(1)
    })
  )
  .handler(async ({ data }) => {
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, data.providerId)
    });

    if (!provider) {
      throw new PublicError('Provider not found');
    }

    if (data.items.length === 0) {
      throw new PublicError('No models selected');
    }

    const existingModels = await db.query.models.findMany({
      where: and(
        eq(models.providerId, data.providerId),
        inArray(
          models.modelId,
          data.items.map(model => model.modelId)
        )
      )
    });
    const existingIds = new Set(existingModels.map(model => model.modelId));
    const modelsToCreate = data.items.filter(
      model => !existingIds.has(model.modelId)
    );

    if (modelsToCreate.length > 0) {
      await db.insert(models).values(
        modelsToCreate.map(model => ({
          id: generateUUID(),
          name: model.modelId,
          modelId: model.modelId,
          providerId: data.providerId,
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
      skipped: data.items.length - modelsToCreate.length
    };
  });

export const providerQueries = {
  all: () => ['provider'] as const,
  /** Key prefixes, shared by the readers and by anything that
   *  invalidates them, so the two can never drift apart. */
  key: {
    list: () => ['provider', 'list'] as const,
    enabled: () => ['provider', 'enabled'] as const,
    remoteModels: () => ['provider', 'remoteModels'] as const,
    compatible: () => ['provider', 'compatible'] as const
  },
  list: () =>
    queryOptions({
      queryKey: [...providerQueries.key.list()] as const,
      queryFn: () => listProviders()
    }),
  enabled: () =>
    queryOptions({
      queryKey: [...providerQueries.key.enabled()] as const,
      queryFn: () => listEnabledProviders()
    }),
  /** Reaches the provider's own API, so it is only fetched on demand. */
  remoteModels: (input: { providerId: string }) =>
    queryOptions({
      queryKey: [...providerQueries.key.remoteModels(), input] as const,
      queryFn: () => fetchProviderModels({ data: input })
    }),
  compatible: (input: { modelId: string }) =>
    queryOptions({
      queryKey: [...providerQueries.key.compatible(), input] as const,
      queryFn: () => compatibleProviders({ data: input })
    })
};
