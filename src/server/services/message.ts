import '@tanstack/react-start/server-only';

import { and, eq, inArray, or } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type messageCreateSchema,
  type messageDeleteSchema,
  type messageUpdateSchema
} from '@/types/message';
import { db } from '@/db';
import { artifacts, messages } from '@/db/schema';

/** The columns a message goes back to the client with: the row minus the two
 *  ownership keys the caller already knows. */
const clientColumns = {
  id: messages.id,
  parentId: messages.parentId,
  role: messages.role,
  parts: messages.parts,
  reasonDuration: messages.reasonDuration,
  createdAt: messages.createdAt,
  updatedAt: messages.updatedAt
};

export async function listOwnedMessagesInChat(userId: string, chatId: string) {
  return await db.query.messages.findMany({
    where: and(eq(messages.chatId, chatId), eq(messages.userId, userId)),
    orderBy: (messages, { asc }) => [asc(messages.createdAt)],
    columns: {
      userId: false,
      chatId: false
    }
  });
}

/**
 * Write a batch of messages and hand back the first.
 *
 * The caller sends a user message and its pending assistant reply together and
 * wants the user message back to render at once, which is why a bulk insert
 * returns a single row.
 */
export async function insertMessagesReturningFirst(
  userId: string,
  input: z.infer<typeof messageCreateSchema>
) {
  const result = await db
    .insert(messages)
    .values(
      input.messages.map(message => ({
        id: message.id,
        parentId: message.metadata?.parentId,
        role: message.role,
        parts: message.parts,
        chatId: input.chatId,
        userId,
        reasonDuration: message.metadata?.reasonDuration,
        createdAt: message.metadata?.createdAt,
        updatedAt: message.metadata?.updatedAt
      }))
    )
    .returning(clientColumns);

  return result[0];
}

/**
 * Rewrite the parts of a message the user wrote.
 *
 * Assistant messages are not editable, so the role is part of the where clause
 * rather than a check: a request naming one simply matches no row.
 */
export async function updateOwnUserMessage(
  userId: string,
  input: z.infer<typeof messageUpdateSchema>
) {
  const result = await db
    .update(messages)
    .set({
      parts: input.message.parts,
      updatedAt: new Date()
    })
    .where(
      and(
        eq(messages.id, input.message.id),
        eq(messages.userId, userId),
        eq(messages.role, 'user')
      )
    )
    .returning(clientColumns);

  return result[0];
}

/**
 * Delete a message and its replies (by `id`), or a whole branch (by
 * `parentId`), taking the artifacts those messages produced with them. One
 * transaction, so a half-deleted branch is never left behind.
 */
export async function deleteOwnMessagesAndArtifacts(
  userId: string,
  target: z.infer<typeof messageDeleteSchema>
) {
  const conditions = target.id
    ? or(eq(messages.id, target.id), eq(messages.parentId, target.id))
    : eq(messages.parentId, target.parentId!);

  await db.transaction(async tx => {
    const targetMessages = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(conditions, eq(messages.userId, userId)));

    const targetMessageIds = targetMessages.map(message => message.id);

    if (targetMessageIds.length > 0) {
      await tx
        .delete(artifacts)
        .where(
          and(
            inArray(artifacts.messageId, targetMessageIds),
            eq(artifacts.userId, userId)
          )
        );
    }

    await tx
      .delete(messages)
      .where(and(conditions, eq(messages.userId, userId)));
  });
}
