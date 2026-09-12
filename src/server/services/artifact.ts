import '@tanstack/react-start/server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { artifacts } from '@/db/schema';

/**
 * One artifact with its full content, or null when the id names nothing the
 * user owns. Library downloads read through here; the list feed carries only
 * a truncated preview.
 */
export async function getArtifact(userId: string, id: string) {
  const artifact = await db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.userId, userId)),
    columns: {
      userId: false
    }
  });
  return artifact ?? null;
}

/**
 * Every artifact in one of the user's chats, oldest first. Each is an
 * independent product of the message that created it; the canvas switches
 * between them.
 */
export async function listArtifacts(userId: string, chatId: string) {
  return await db.query.artifacts.findMany({
    where: and(eq(artifacts.chatId, chatId), eq(artifacts.userId, userId)),
    orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
    columns: {
      userId: false
    }
  });
}
