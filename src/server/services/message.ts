import '@tanstack/react-start/server-only';

import { and, eq, inArray, or } from 'drizzle-orm';
import { type z } from 'zod';

import { type Artifact } from '@/types';
import {
  type messageCreateSchema,
  type messageDeleteSchema,
  type messageUpdateSchema
} from '@/types/message';
import { db } from '@/db';
import { artifacts, messages } from '@/db/schema';

/** The parts array a message carries, as the column stores it. */
type MessageParts = typeof messages.$inferInsert.parts;

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

export async function listMessages(userId: string, chatId: string) {
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
export async function createMessages(
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
export async function updateMessage(
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
export async function deleteMessages(
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

/**
 * Persist an assistant turn that was refused before the model ran.
 *
 * `createdAt` is left to the database. The user's message was stored with the
 * database's clock, and a refusal lands milliseconds later — close enough that
 * any skew between that clock and this process's puts the refusal *before* the
 * message it answers, and the thread renders in that order on reload. The
 * normal path passes its own timestamp and gets away with it only because a
 * model takes seconds.
 */
export async function createRefusal(
  userId: string,
  input: {
    id: string;
    parentId: string;
    chatId: string;
    parts: MessageParts;
  }
) {
  await db.insert(messages).values({
    id: input.id,
    parentId: input.parentId,
    role: 'assistant',
    parts: input.parts,
    chatId: input.chatId,
    userId
  });
}

/**
 * Persist a finished assistant turn together with the artifacts it produced.
 *
 * One transaction: an artifact pinned to a message that was never written
 * would be unreachable, and a turn that claims artifacts it does not have
 * renders as a gap.
 */
export async function createTurn(
  userId: string,
  input: {
    message: {
      id: string;
      parentId: string;
      role: 'assistant';
      parts: MessageParts;
      reasonDuration?: number;
      createdAt: Date;
      updatedAt: Date;
    };
    chatId: string;
    artifacts: Artifact[];
  }
) {
  await db.transaction(async tx => {
    await tx.insert(messages).values({
      id: input.message.id,
      parentId: input.message.parentId,
      role: input.message.role,
      parts: input.message.parts,
      chatId: input.chatId,
      userId,
      reasonDuration: input.message.reasonDuration,
      createdAt: input.message.createdAt,
      updatedAt: input.message.updatedAt
    });

    // Each artifact created this turn is its own independent row, pinned to
    // this turn's message.
    if (input.artifacts.length > 0) {
      await tx.insert(artifacts).values(
        input.artifacts.map(artifact => ({
          id: artifact.id,
          chatId: input.chatId,
          messageId: input.message.id,
          userId,
          title: artifact.title,
          type: artifact.type,
          language: artifact.language ?? null,
          content: artifact.content ?? null,
          fileUrl: artifact.fileUrl ?? null,
          fileName: artifact.fileName ?? null,
          mimeType: artifact.mimeType ?? null,
          size: artifact.size ?? null,
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt
        }))
      );
    }
  });
}
