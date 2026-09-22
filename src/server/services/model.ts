import '@tanstack/react-start/server-only';

import { and, count, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type modelCreateSchema,
  type modelListSchema,
  type ModelStatus,
  type modelUpdateSchema
} from '@/types/model';
import { pageWindow } from '@/types/pagination';
import { perRequest } from '@/lib/request-cache';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { modelProviders, models, providers } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { assertWritten, unchangedSince } from '@/server/services/stale-edit';

type Provider = typeof providers.$inferSelect;
type ProviderBinding = typeof modelProviders.$inferSelect & {
  provider: Provider | null;
};
type Model = typeof models.$inferSelect & {
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
        providers: {
          with: { provider: true }
        }
      },
      orderBy: (models, { asc }) => [asc(models.displayOrder)]
    });

    return result
      .map(m => {
        // Enabled bindings ordered by priority, the provider enabled too.
        const providersList: ProviderBinding[] = (m.providers ?? [])
          .filter(b => b.isEnabled && b.provider?.isEnabled)
          // Two bindings may share a priority — the form takes any number —
          // and the rows arrive in no promised order, so which provider a
          // model reached first could change from one request to the next.
          // The id settles a tie the same way every time.
          .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

        return { ...m, providers: providersList };
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

/**
 * Models bound to a provider the condition matches.
 *
 * A model reaches its providers through `model_provider`, and a relational
 * `where` cannot see across that table — so the condition is answered as a
 * subquery over the bindings and the model is matched on the ids it returns.
 */
function boundTo(condition: SQL | undefined) {
  return inArray(
    models.modelId,
    db
      .select({ modelId: modelProviders.modelId })
      .from(modelProviders)
      .innerJoin(providers, eq(providers.id, modelProviders.providerId))
      .where(condition)
  );
}

/** The console's model table: one page of models, with their provider bindings. */
export async function listModels(filter: z.infer<typeof modelListSchema>) {
  const search = filter.q?.trim();
  const term = search ? `%${search}%` : null;
  const where = and(
    filter.capability ? eq(models.capability, filter.capability) : undefined,
    term
      ? or(
          ilike(models.name, term),
          ilike(models.modelId, term),
          // Matching the provider by name needs its row, and a relational
          // `where` cannot reach one — so name the matching models instead.
          boundTo(ilike(providers.name, term))
        )
      : undefined
  );

  const [rows, [totalRow]] = await Promise.all([
    db.query.models.findMany({
      where,
      ...pageWindow(filter),
      // `id` last so the order is total: models seeded together share a display
      // order and a creation time, and paging by row offset over an order that
      // leaves ties unbroken can repeat a row on one page and skip it on the next.
      orderBy: (models, { asc, desc }) => [
        asc(models.displayOrder),
        desc(models.createdAt),
        asc(models.id)
      ],
      with: {
        providers: {
          with: { provider: true },
          orderBy: (binding, { asc }) => [
            asc(binding.priority),
            asc(binding.id)
          ]
        }
      }
    }),
    db.select({ count: count() }).from(models).where(where)
  ]);

  return {
    rows,
    total: Number(totalRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/**
 * Every model, for the selectors that offer one, each saying how it stands.
 *
 * A dropdown has to hold the whole list — a page of it would hide the model
 * the user is looking for — so this is deliberately unpaged, and it offers the
 * ones that cannot answer too: a model is picked here before it is switched
 * on, and a setting already pointing at one that has stopped answering has to
 * keep showing it rather than quietly reading as unset. Saying which is which
 * is `status`; the bindings it is read from do not travel, because nothing
 * choosing a model reads them.
 */
export async function listModelsForSelect() {
  const rows = await db.query.models.findMany({
    orderBy: (models, { asc, desc }) => [
      asc(models.displayOrder),
      desc(models.createdAt)
    ],
    with: { providers: { with: { provider: true } } }
  });

  return rows.map(({ providers, ...model }) => ({
    ...model,
    status: statusOf(model.isEnabled, providers)
  }));
}

/**
 * Which switch, if either, is stopping a model answering.
 *
 * Read from `model_providers` alone. The `provider_id` column beside it is a
 * mirror of the first enabled binding, written by `createModel` and kept in
 * step by `updateModel` — asking it would be asking a copy.
 *
 * This is the console's own reading. `getAllModels` answers a different
 * question, for a different caller, and is none of this function's business.
 */
function statusOf(
  isEnabled: boolean,
  bindings: Array<{
    isEnabled: boolean;
    provider: { isEnabled: boolean } | null;
  }>
): ModelStatus {
  if (!isEnabled) return 'disabled';

  const served = bindings.some(
    binding => binding.isEnabled && binding.provider?.isEnabled
  );

  return served ? 'available' : 'no-enabled-provider';
}

export async function createModel(input: z.infer<typeof modelCreateSchema>) {
  const normalizedModelId = input.modelId.trim();

  // A model and a provider are separate things that get paired, and writing a
  // model is a deliberate act about that model — so it arrives paired. What the
  // database does not constrain, because a provider deleted out from under a
  // model leaves it unpaired and there is nothing to refuse at that moment.
  const bindings = input.providers ?? [];
  if (bindings.length === 0) {
    throw new PublicError('At least one provider is required');
  }
  const bindingProviderIds = bindings.map(b => b.providerId);
  if (new Set(bindingProviderIds).size !== bindingProviderIds.length) {
    throw new PublicError('A provider can only be added once per model');
  }
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
  const {
    id,
    providers: inputProviders,
    expectedUpdatedAt,
    ...updates
  } = input;
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

  if (inputProviders) {
    // Leaving the list out means "don't touch the pairings". Sending an empty
    // one asks for a model nothing can serve, which is refused here for the
    // same reason `createModel` refuses it.
    if (inputProviders.length === 0) {
      throw new PublicError('At least one provider is required');
    }
    const ids = inputProviders.map(b => b.providerId);
    if (new Set(ids).size !== ids.length) {
      throw new PublicError('A provider can only be added once per model');
    }
  }

  await db.transaction(async tx => {
    const written = await tx
      .update(models)
      .set({ ...sanitizedUpdates, updatedAt: new Date() })
      .where(
        and(
          eq(models.id, id),
          unchangedSince(models.updatedAt, expectedUpdatedAt)
        )
      )
      .returning({ id: models.id });
    // Thrown inside the transaction, so the pairings below are not touched
    // either when the save is refused.
    assertWritten(written, expectedUpdatedAt, 'model');

    // Replace the pairings when an explicit list is supplied. Never empty by
    // here, so the delete is always followed by an insert.
    if (inputProviders) {
      await tx
        .delete(modelProviders)
        .where(eq(modelProviders.modelId, targetModelId));
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
