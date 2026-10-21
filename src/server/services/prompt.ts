import '@tanstack/react-start/server-only';

import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { type z } from 'zod';

import { type ModelCapability } from '@/types';
import { pageWindow } from '@/types/pagination';
import {
  type promptCreateSchema,
  type promptListSchema,
  type promptPageSchema,
  type promptUpdateSchema
} from '@/types/prompt';
import { fitsMediaKind, promptMediaKinds } from '@/lib/prompt';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { models, prompts } from '@/db/schema';
import { PublicError } from '@/server/public-error';

// `id` last so the order is total: prompts seeded together share a display
// order and a creation time, and paging by row offset over an order that
// leaves ties unbroken can repeat a row on one page and skip it on the next.
const promptOrderBy = [
  asc(prompts.displayOrder),
  desc(prompts.createdAt),
  asc(prompts.id)
];

const promptOwner = {
  user: {
    columns: {
      id: true,
      name: true,
      email: true
    }
  }
} as const;

async function getPromptByIdOrThrow(id: string) {
  const prompt = await db.query.prompts.findFirst({
    where: eq(prompts.id, id),
    with: promptOwner
  });

  if (!prompt) {
    throw new Response('Prompt not found', { status: 404 });
  }

  return prompt;
}

/**
 * Whether what a prompt presets holds together: its model, where it names
 * one, is a model there is, and one its type and reference call for — a chat
 * model for a chat prompt, else one an entry of the media generation
 * settings it is tried on can use.
 */
async function checkPreset(preset: {
  type: ModelCapability;
  needsReference: boolean;
  modelId: string | null;
}) {
  if (!preset.modelId) return;
  const model = await db.query.models.findFirst({
    where: eq(models.modelId, preset.modelId)
  });
  if (!model) throw new PublicError('The model does not exist.');
  const fits =
    preset.type === 'chat'
      ? model.capability === 'chat'
      : promptMediaKinds(preset.type, preset.needsReference).some(kind =>
          fitsMediaKind(kind, model)
        );
  if (!fits) {
    throw new PublicError(`${model.name} cannot be this prompt’s model.`);
  }
}

export async function getPromptStats() {
  const [totalRows, groupedRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(prompts),
    db
      .select({
        visibility: prompts.visibility,
        count: sql<number>`count(*)`
      })
      .from(prompts)
      .groupBy(prompts.visibility)
  ]);

  const countFor = (visibility: 'public' | 'private') =>
    Number(groupedRows.find(row => row.visibility === visibility)?.count || 0);

  return {
    total: Number(totalRows[0]?.count || 0),
    public: countFor('public'),
    private: countFor('private')
  };
}

/** One page of every prompt in the system, regardless of owner or visibility,
 *  each with its owner. */
export async function adminListPrompts(
  filter: z.infer<typeof promptListSchema>
) {
  const search = filter.search?.trim();
  const where = search
    ? or(
        ilike(prompts.name, `%${search}%`),
        ilike(prompts.content, `%${search}%`)
      )
    : undefined;

  const [rows, [totalRow]] = await Promise.all([
    db.query.prompts.findMany({
      where,
      ...pageWindow(filter),
      orderBy: () => promptOrderBy,
      with: promptOwner
    }),
    db.select({ count: count() }).from(prompts).where(where)
  ]);

  return {
    rows,
    total: Number(totalRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/** What a page of prompts is narrowed to: a term in the name or the content,
 *  and a tag the prompt carries. */
function pageFilter(page: z.infer<typeof promptPageSchema>) {
  const search = page?.search?.trim();
  return [
    search
      ? or(
          ilike(prompts.name, `%${search}%`),
          ilike(prompts.content, `%${search}%`)
        )
      : undefined,
    page?.tag
      ? sql`${prompts.tags} @> ${JSON.stringify([page.tag])}::jsonb`
      : undefined
  ];
}

/** The user's own prompts, for managing their personal library. Paged, like
 *  `listUsablePrompts`. */
export async function listPrompts(
  userId: string,
  page?: z.infer<typeof promptPageSchema>
) {
  const where = and(eq(prompts.userId, userId), ...pageFilter(page));

  return await db.query.prompts.findMany({
    limit: page?.limit,
    offset: page?.cursor ?? 0,
    where,
    orderBy: () => promptOrderBy
  });
}

/**
 * Prompts the user may insert: their own at any visibility, plus every public
 * one. Paged for the gallery, whole for the composer's suggestions.
 */
export async function listUsablePrompts(
  userId: string,
  page?: z.infer<typeof promptPageSchema>
) {
  const where = and(
    or(eq(prompts.userId, userId), eq(prompts.visibility, 'public')),
    ...pageFilter(page)
  );

  return await db.query.prompts.findMany({
    limit: page?.limit,
    offset: page?.cursor ?? 0,
    columns: {
      id: true,
      name: true,
      tags: true,
      type: true,
      needsReference: true,
      modelId: true,
      image: true,
      content: true
    },
    where,
    orderBy: () => promptOrderBy
  });
}

/**
 * Write a prompt owned by `userId`.
 *
 * `visibility` comes from which server function was called — private for a
 * user's own prompt, public for one the console adds to the shared gallery —
 * and not from the input, which no longer carries the field at all.
 */
export async function createPrompt(
  userId: string,
  input: z.infer<typeof promptCreateSchema>,
  /** Decided by which server function was called, never by the client. */
  visibility: 'private' | 'public'
) {
  const id = generateUUID();
  const preset = {
    type: input.type,
    needsReference: input.needsReference,
    modelId: input.modelId ?? null
  };
  await checkPreset(preset);

  await db.insert(prompts).values({
    id,
    name: input.name,
    userId,
    visibility,
    tags: input.tags,
    ...preset,
    image: input.image,
    content: input.content,
    displayOrder: input.displayOrder
  });

  return { id };
}

/** An edit that changes what the prompt presets is checked as the prompt it
 *  leaves: what it changes over what the prompt already said. One that leaves
 *  the preset alone is not held to it. */
async function writePromptFields(
  input: z.infer<typeof promptUpdateSchema>,
  current: Pick<
    typeof prompts.$inferSelect,
    'type' | 'needsReference' | 'modelId'
  >
) {
  const { id, ...updates } = input;
  if (
    updates.type !== undefined ||
    updates.needsReference !== undefined ||
    updates.modelId !== undefined
  ) {
    await checkPreset({
      type: updates.type ?? current.type,
      needsReference: updates.needsReference ?? current.needsReference,
      modelId: updates.modelId !== undefined ? updates.modelId : current.modelId
    });
  }

  await db
    .update(prompts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(prompts.id, id));
}

/**
 * Editing and deleting each stay two functions. The owner path always checks
 * ownership; the admin path reaches every prompt in the system. One function
 * with an optional owner would let a caller drop the check by leaving an
 * argument out.
 */
export async function updatePrompt(
  userId: string,
  input: z.infer<typeof promptUpdateSchema>
) {
  const prompt = await getPromptByIdOrThrow(input.id);
  if (prompt.userId !== userId) {
    throw new Response('You can only edit your own prompts', { status: 403 });
  }
  await writePromptFields(input, prompt);
}

/** One prompt as the console edits it, whoever owns it, read at the moment
 *  the form opens. */
export async function adminGetPrompt(id: string) {
  return await db.query.prompts.findFirst({
    where: eq(prompts.id, id),
    with: promptOwner
  });
}

export async function adminUpdatePrompt(
  input: z.infer<typeof promptUpdateSchema>
) {
  const prompt = await getPromptByIdOrThrow(input.id);
  await writePromptFields(input, prompt);
}

export async function deletePrompt(userId: string, id: string) {
  const prompt = await getPromptByIdOrThrow(id);
  if (prompt.userId !== userId) {
    throw new Response('You can only delete your own prompts', {
      status: 403
    });
  }
  await db.delete(prompts).where(eq(prompts.id, id));
}

export async function adminDeletePrompt(id: string) {
  await getPromptByIdOrThrow(id);
  await db.delete(prompts).where(eq(prompts.id, id));
}
