import '@tanstack/react-start/server-only';

import { and, count, eq, gte, like, lt, or, sql } from 'drizzle-orm';
import { type z } from 'zod';

import { pageWindow } from '@/types/pagination';
import {
  type profileUpdateSchema,
  type userRoleSchema,
  type userSearchSchema
} from '@/types/user';
import { db } from '@/db';
import { accounts, chats, messages, users } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import { blobUrlsOfMessages, removeBlobs } from '@/server/services/blob';
import { dayOf, withLock } from '@/server/services/db-utils';
import {
  hasLiveSubscription,
  liveSubscriptionsOf
} from '@/server/services/subscription';
import { getUserTier } from '@/server/services/tier';

/**
 * Make a new account an admin when the install has none, so a fresh deploy
 * has a way into /console. Counted rather than assumed, so it stays correct
 * if the first admin is later demoted and someone else signs up.
 *
 * Under a lock, because counting and promoting are two statements: two
 * people signing up to an empty install at once would each count none, and
 * each be made admin. The second waits, then counts one.
 */
export async function makeFirstUserAdmin(userId: string) {
  await withLock('first-admin', async tx => {
    const [admins] = await tx
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, 'admin'));
    if (admins?.value === 0) {
      await tx.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
    }
  });
}

/**
 * The signed-in user's own row.
 *
 * Throws rather than returning null: the middleware has already verified the
 * session, so a missing row means the session is stale. A bare Error would
 * surface as a 500 and give the client no reason to sign out, so this answers
 * 401 instead.
 */
export async function getMe(userId: string) {
  const user = await db.select().from(users).where(eq(users.id, userId));

  if (!user[0]) {
    throw new Response('Session expired', { status: 401 });
  }

  return user[0];
}

export async function updateProfile(
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
export async function listUsers(filter: z.infer<typeof userSearchSchema>) {
  const search = filter.search?.trim();
  const where = search
    ? or(like(users.name, `%${search}%`), like(users.email, `%${search}%`))
    : undefined;

  const [rows, [totalRow]] = await Promise.all([
    db.query.users.findMany({
      where,
      ...pageWindow(filter),
      // `id` last so the order is total: accounts created in the same import
      // share a timestamp, and offset paging over an order that leaves ties
      // unbroken can repeat a row on one page and skip it on the next.
      orderBy: (users, { asc, desc }) => [desc(users.createdAt), asc(users.id)],
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
        },
        tier: {
          columns: {
            id: true,
            name: true,
            priceMultiplier: true
          }
        }
      }
    }),
    db.select({ count: count() }).from(users).where(where)
  ]);
  // The subscription in effect behind each one's plan, if any: shown under
  // the plan, and a user who has one cannot be deleted.
  const live = await liveSubscriptionsOf(rows.map(r => r.id));

  return {
    rows: rows.map(row => ({ ...row, subscription: live.get(row.id) ?? null })),
    total: Number(totalRow?.count ?? 0),
    page: filter.page,
    pageSize: filter.pageSize
  };
}

/**
 * One user with what the console's detail page shows: linked accounts, how
 * much they have written, and the tier in force for them. Throws when the
 * id names nobody.
 */
export async function getUser(id: string) {
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
    messageCount: Number(messageCount[0]?.count || 0),
    // The tier in force — their own, the plan's or the default — as
    // distinct from `tierId`, which is only their own.
    effectiveTier: await getUserTier(id)
  };
}

/** `actingUserId` is required, not optional: an admin must not be able to
 *  strip their own admin role and lock themselves out of the console. */
export async function updateUserRole(
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

  // Deleting the account would not stop the processor charging for it.
  if (await hasLiveSubscription(id)) {
    throw new PublicError(
      'This user has a subscription in effect, so the account cannot be deleted.'
    );
  }

  // Everything the account owns goes with the row. Its files are not rows,
  // so they are gathered first: what its messages hold, and its avatar.
  const [account] = await db
    .select({ image: users.image })
    .from(users)
    .where(eq(users.id, id));
  const urls = await blobUrlsOfMessages(eq(messages.userId, id));
  if (account?.image) urls.push(account.image);

  await db.delete(users).where(eq(users.id, id));
  await removeBlobs(id, urls);
  return { success: true };
}

export async function getUserStats() {
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

/**
 * Who signed up from `since` to `until`: everyone signed up by its close and
 * those who signed up in it, summed in SQL, and how many signed up on each
 * of its days that had any.
 */
export async function userSummary(since: Date, until?: Date, step?: number) {
  const joined = db.$with('joined').as(
    db
      .select({ day: dayOf(since, users.createdAt, step).as('day') })
      .from(users)
      .where(
        and(
          gte(users.createdAt, since),
          until ? lt(users.createdAt, until) : undefined
        )
      )
  );
  const [[total], days] = await Promise.all([
    db
      .select({
        users: count(),
        newUsers:
          sql<number>`count(*) filter (where ${gte(users.createdAt, since)})`.mapWith(
            Number
          )
      })
      .from(users)
      .where(until ? lt(users.createdAt, until) : undefined),
    db
      .with(joined)
      .select({ day: joined.day, newUsers: count() })
      .from(joined)
      .groupBy(joined.day)
  ]);
  return { total, days };
}
