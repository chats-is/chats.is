import '@tanstack/react-start/server-only';

import { and, count, eq, gt, isNotNull, ne, sql } from 'drizzle-orm';
import { type z } from 'zod';

import {
  type chatCreateSchema,
  type chatDetailSchema,
  type chatListSchema,
  type chatUpdateSchema
} from '@/types/chat';
import { db } from '@/db';
import { artifacts, chats, messages } from '@/db/schema';
import { blobUrlsOfMessages, removeBlobs } from '@/server/services/blob';

/**
 * Create a chat together with the messages that opened it.
 *
 * The two writes belong to one act: a chat with no messages is never a state
 * the app wants to read back.
 */
export async function createChat(
  userId: string,
  input: z.infer<typeof chatCreateSchema>
) {
  await db.transaction(async tx => {
    await tx.insert(chats).values({
      id: input.id,
      title: input.title,
      type: input.type,
      modelId: input.modelId,
      userId
    });

    await tx.insert(messages).values(
      input.messages.map(message => ({
        id: message.id,
        role: message.role,
        parts: message.parts,
        chatId: input.id,
        userId
      }))
    );
  });
}

/** Rename a chat or move it to another model. Absent fields are left alone,
 *  and a request naming none writes nothing. */
export async function updateChat(
  userId: string,
  input: z.infer<typeof chatUpdateSchema>
) {
  const updates: Record<string, unknown> = {};
  if (input.title) updates.title = input.title;
  if (input.modelId) updates.modelId = input.modelId;

  if (Object.keys(updates).length === 0) return;

  await db
    .update(chats)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(chats.id, input.id), eq(chats.userId, userId)));
}

export async function listChats(
  userId: string,
  input: z.infer<typeof chatListSchema>
) {
  const limit = input.limit ?? 50;
  const offset = input.cursor ?? input.offset ?? 0;

  return await db.query.chats.findMany({
    orderBy: (chats, { desc }) => [desc(chats.createdAt)],
    limit: limit,
    offset: offset,
    where: and(
      eq(chats.userId, userId),
      input.type ? eq(chats.type, input.type) : undefined
    ),
    columns: {
      userId: false
    }
  });
}

/**
 * One of the user's chats, or null.
 *
 * `modelId` comes back null when the model or its provider has since been
 * disabled, so the caller cannot offer to continue a conversation on a model
 * that can no longer answer.
 */
export async function getChat(
  userId: string,
  input: z.infer<typeof chatDetailSchema>
) {
  const chat = await db.query.chats.findFirst({
    where: and(
      eq(chats.id, input.id),
      eq(chats.userId, userId),
      input.type ? eq(chats.type, input.type) : undefined
    ),
    with: {
      model: {
        with: {
          providers: { with: { provider: true } }
        }
      },
      messages: input.includeMessages
        ? {
            where: eq(messages.userId, userId),
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
            columns: {
              userId: false,
              chatId: false
            }
          }
        : undefined,
      artifacts: input.includeArtifacts
        ? {
            where: and(
              eq(artifacts.userId, userId),
              isNotNull(artifacts.messageId)
            ),
            orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
            columns: {
              userId: false
            }
          }
        : undefined
    },
    columns: {
      userId: false
    }
  });

  if (!chat) return null;

  return {
    ...chat,
    // A chat keeps naming its model only while that model can still answer:
    // switched on, and with a provider of its own switched on.
    modelId:
      chat.model?.isEnabled &&
      chat.model.providers.some(
        binding => binding.isEnabled && binding.provider?.isEnabled
      )
        ? chat.model.modelId
        : null
  };
}

/** Delete a chat — its messages and artifacts go with the row, and its files
 *  once nothing points at them (see `removeBlobs`). */
export async function deleteChat(userId: string, id: string) {
  const urls = await blobUrlsOfMessages(
    and(eq(messages.chatId, id), eq(messages.userId, userId))!
  );
  await db.delete(chats).where(and(eq(chats.id, id), eq(chats.userId, userId)));
  await removeBlobs(userId, urls);
}

export async function deleteAllChats(userId: string) {
  const urls = await blobUrlsOfMessages(eq(messages.userId, userId));
  await db.delete(chats).where(eq(chats.userId, userId));
  await removeBlobs(userId, urls);
}

/**
 * How many replies one person may have being written at once, across all their
 * chats.
 *
 * The quota is checked when a turn starts and charged when it ends, and a turn
 * can take minutes. Nothing in between is counted, so without a bound a burst
 * of requests all pass the same check and all spend. This is the bound: what
 * can be overspent is at most this many turns, whatever is sent.
 */
export const MAX_CONCURRENT_GENERATIONS = 3;

/**
 * How long a generation is believed to be running with nothing to say it
 * ended. A function that is killed never clears its claim, and the platform
 * allows a turn five minutes — past this, a claim is a leftover.
 */
const GENERATION_CLAIM_MS = 6 * 60 * 1000;

/**
 * Claim the chat for a generation, unless the user already has as many running
 * as they may. Answers whether the claim was made.
 *
 * `streamId` is the claim: set while a reply is being written, cleared when it
 * ends, and the name of the resumable stream in between. Counting and claiming
 * happen under one lock per user, so requests arriving together are counted
 * one after another rather than all against the same number.
 *
 * Claiming a chat that is already claimed takes it over — the generation that
 * held it finds the claim gone and stops (see `isGenerating`). A chat has one
 * reply in flight, and the newest request is the one the user is looking at.
 */
export async function beginGeneration(
  userId: string,
  input: { chatId: string; streamId: string }
): Promise<boolean> {
  return await db.transaction(async tx => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`generation:${userId}`}))`
    );

    const [running] = await tx
      .select({ value: count() })
      .from(chats)
      .where(
        and(
          eq(chats.userId, userId),
          ne(chats.id, input.chatId),
          isNotNull(chats.streamId),
          gt(chats.updatedAt, new Date(Date.now() - GENERATION_CLAIM_MS))
        )
      );

    if ((running?.value ?? 0) >= MAX_CONCURRENT_GENERATIONS) return false;

    const claimed = await tx
      .update(chats)
      .set({ streamId: input.streamId, updatedAt: new Date() })
      .where(and(eq(chats.id, input.chatId), eq(chats.userId, userId)))
      .returning({ id: chats.id });

    // No row, no claim: the chat was deleted since it was read, or was never
    // this user's. Saying yes would start a paid generation that finds, at its
    // first check, that it holds nothing.
    return claimed.length > 0;
  });
}

/** Whether `streamId` still holds the chat — false once it was stopped, or
 *  taken over by a newer turn. */
export async function isGenerating(chatId: string, streamId: string) {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    columns: { streamId: true }
  });
  return chat?.streamId === streamId;
}

/**
 * What became of a generation's claim: still `held`, `stopped` by the user —
 * the claim withdrawn and nothing in its place — or `superseded`, the chat
 * taken over by a newer turn.
 *
 * The last two both end the generation, and differ in what should be kept. A
 * stopped reply is the reply: what was written is stored as it stands. A
 * superseded one answers a conversation that has since been cut back and
 * answered again, and storing it would put a second, stale reply beside the
 * new one — or fail outright, its parent message being gone.
 */
export async function generationState(
  chatId: string,
  streamId: string
): Promise<'held' | 'stopped' | 'superseded'> {
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    columns: { streamId: true }
  });
  if (chat?.streamId === streamId) return 'held';
  return chat?.streamId ? 'superseded' : 'stopped';
}

/** Let go of the chat, if this generation is still the one holding it. */
export async function endGeneration(chatId: string, streamId: string) {
  await db
    .update(chats)
    .set({ streamId: null })
    .where(and(eq(chats.id, chatId), eq(chats.streamId, streamId)));
}

/**
 * Stop whatever is being written in one of the user's chats.
 *
 * The generation may be running in another process, so it is not told — the
 * claim is withdrawn, and the generation, which checks that it still holds the
 * chat, stops when it finds it does not.
 */
export async function stopGeneration(userId: string, chatId: string) {
  await db
    .update(chats)
    .set({ streamId: null })
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
}

/**
 * The stream a reply is being written to right now, or null.
 *
 * Scoped to the owner: only they may reconnect to a stream of theirs. Null
 * when the chat is not theirs, and when nothing is being written in it.
 */
export async function getStreamId(userId: string, chatId: string) {
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    columns: { streamId: true }
  });
  return chat?.streamId ?? null;
}
