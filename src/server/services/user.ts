import '@tanstack/react-start/server-only';

import { eq, like, or, sql } from 'drizzle-orm';
import { type z } from 'zod';

import { type profileUpdateSchema, type userRoleSchema } from '@/types/user';
import { db } from '@/db';
import { accounts, chats, messages, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';

/**
 * The signed-in user's own row.
 *
 * Throws rather than returning null: the middleware has already verified the
 * session, so a missing row means the session is stale. A bare Error would
 * surface as a 500 and give the client no reason to sign out, so this answers
 * 401 instead.
 */
export async function requireCurrentUser(userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId));

  if (!user[0]) {
    throw new Response('Session expired', { status: 401 });
  }

  return user[0];
}

export async function updateOwnProfile(
  userId: string,
  input: z.infer<typeof profileUpdateSchema>
) {
  const updates: { name?: string; image?: string; updatedAt?: Date } = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.image !== undefined) updates.image = input.image;

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date();
    await db.update(users).set(updates).where(eq(users.id, userId));
  }

  return { success: true };
}

/** Users with their sign-in methods, plan and quota override, newest first. */
export async function listUsers(search?: string) {
  return await db.query.users.findMany({
    where: search
      ? or(like(users.name, `%${search}%`), like(users.email, `%${search}%`))
      : undefined,
    orderBy: (users, { desc }) => [desc(users.createdAt)],
    with: {
      accounts: {
        columns: {
          providerId: true
        }
      },
      plan: {
        columns: {
          id: true,
          name: true
        }
      },
      quota: {
        columns: {
          id: true,
          name: true,
          isUnlimited: true
        }
      }
    }
  });
}

/** Pass planId=null to clear it; the user falls back to the default. */
export async function setUserPlan(id: string, planId: string | null) {
  await db
    .update(users)
    .set({ planId, updatedAt: new Date() })
    .where(eq(users.id, id));
}

/**
 * One user with what the console's detail page shows: linked accounts, and
 * how much they have written. Throws when the id names nobody.
 */
export async function requireUserDetail(id: string) {
  const user = await db.select().from(users).where(eq(users.id, id));

  if (!user[0]) {
    throw new PublicError('User not found');
  }

  const linkedAccounts = await db
    .select({
      provider: accounts.providerId,
      providerAccountId: accounts.accountId
    })
    .from(accounts)
    .where(eq(accounts.userId, id));

  const chatCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(chats)
    .where(eq(chats.userId, id));

  const messageCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.userId, id));

  return {
    ...user[0],
    accounts: linkedAccounts,
    chatCount: Number(chatCount[0]?.count || 0),
    messageCount: Number(messageCount[0]?.count || 0)
  };
}

/** `actingUserId` is required, not optional: an admin must not be able to
 *  strip their own admin role and lock themselves out of the console. */
export async function setUserRole(
  actingUserId: string,
  input: z.infer<typeof userRoleSchema>
) {
  if (actingUserId === input.id && input.role !== 'admin') {
    throw new PublicError('Cannot remove your own admin role');
  }

  const result = await db
    .update(users)
    .set({ role: input.role, updatedAt: new Date() })
    .where(eq(users.id, input.id))
    .returning();

  return result[0];
}

/** Refuses to delete the acting admin, or any other admin. */
export async function deleteUser(actingUserId: string, id: string) {
  if (actingUserId === id) {
    throw new PublicError('Cannot delete your own account');
  }

  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, id));

  if (user[0]?.role === 'admin') {
    throw new PublicError('Cannot delete admin accounts');
  }

  await db.delete(users).where(eq(users.id, id));
  return { success: true };
}

export async function countUsers() {
  const totalUsers = await db
    .select({ count: sql<number>`count(*)` })
    .from(users);

  const adminCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, 'admin'));

  return {
    total: Number(totalUsers[0]?.count || 0),
    admins: Number(adminCount[0]?.count || 0)
  };
}
