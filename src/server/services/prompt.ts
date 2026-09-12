import '@tanstack/react-start/server-only';

import { asc, desc, eq, or, sql } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type promptCreateSchema,
  type promptPageSchema,
  type promptUpdateSchema
} from '@/types/prompt';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { prompts } from '@/db/schema';

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

/** Every prompt in the system, regardless of owner or visibility. */
export async function adminListPrompts() {
  return await db.query.prompts.findMany({
    orderBy: () => promptOrderBy,
    with: promptOwner
  });
}

/** The user's own prompts, for managing their personal library. */
export async function listPrompts(userId: string) {
  return await db.query.prompts.findMany({
    where: eq(prompts.userId, userId),
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
  return await db.query.prompts.findMany({
    limit: page?.limit,
    offset: page?.cursor ?? 0,
    columns: {
      id: true,
      name: true,
      tags: true,
      providers: true,
      models: true,
      image: true,
      content: true
    },
    where: or(eq(prompts.userId, userId), eq(prompts.visibility, 'public')),
    orderBy: () => promptOrderBy
  });
}

/**
 * Write a prompt owned by `userId`. `defaultVisibility` is what the caller
 * falls back to when the input names none: private for a user's own prompt,
 * public for one an admin adds to the shared gallery.
 */
export async function createPrompt(
  userId: string,
  input: z.infer<typeof promptCreateSchema>,
  defaultVisibility: 'private' | 'public'
) {
  const id = generateUUID();

  await db.insert(prompts).values({
    id,
    name: input.name,
    userId,
    visibility: input.visibility ?? defaultVisibility,
    tags: input.tags,
    providers: input.providers,
    models: input.models,
    image: input.image,
    content: input.content,
    displayOrder: input.displayOrder
  });

  return { id };
}

async function writePromptFields(input: z.infer<typeof promptUpdateSchema>) {
  const { id, ...updates } = input;

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
  await writePromptFields(input);
}

export async function adminUpdatePrompt(
  input: z.infer<typeof promptUpdateSchema>
) {
  await getPromptByIdOrThrow(input.id);
  await writePromptFields(input);
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
