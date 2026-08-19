import { cache } from 'react';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { and, count, eq, gt } from 'drizzle-orm';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';

import { env } from '@/lib/env';
import { generateUUID } from '@/lib/utils';

import { db } from './db';
import {
  accounts,
  emailVerificationCodes,
  sessions,
  users,
  verificationTokens
} from './db/schema';

declare module 'next-auth' {
  interface User {
    role?: string;
  }
  interface Session extends DefaultSession {
    user: {
      id: string;
      admin: boolean;
    } & DefaultSession['user'];
  }
}

export const {
  handlers,
  auth: uncachedAuth,
  signIn,
  signOut
} = NextAuth({
  debug: env.NODE_ENV !== 'production',
  providers: [
    Google({
      clientId: env.AUTH_GOOGLE_ID,
      clientSecret: env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true
    }),
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true
    }),
    Credentials({
      id: 'email-code',
      name: 'Email Code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.code) {
          return null;
        }

        const email = (credentials.email as string).toLowerCase().trim();
        const code = credentials.code as string;

        // Max attempts allowed
        const MAX_ATTEMPTS = 5;

        // Find verification code for this email (not expired)
        const storedCode = await db
          .select()
          .from(emailVerificationCodes)
          .where(
            and(
              eq(emailVerificationCodes.email, email),
              gt(emailVerificationCodes.expires, new Date())
            )
          )
          .limit(1);

        if (storedCode.length === 0) {
          return null;
        }

        // Check if max attempts exceeded
        if (storedCode[0].attempts >= MAX_ATTEMPTS) {
          // Delete the code - user must request a new one
          await db
            .delete(emailVerificationCodes)
            .where(eq(emailVerificationCodes.email, email));
          return null;
        }

        // Check if code matches
        if (storedCode[0].code !== code) {
          // Increment attempts
          await db
            .update(emailVerificationCodes)
            .set({ attempts: storedCode[0].attempts + 1 })
            .where(eq(emailVerificationCodes.id, storedCode[0].id));
          return null;
        }

        // Code is valid - delete it
        await db
          .delete(emailVerificationCodes)
          .where(eq(emailVerificationCodes.email, email));

        // Find or create user
        let user = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (user.length === 0) {
          // Check if there are any admins
          const adminCount = await db
            .select({ count: count() })
            .from(users)
            .where(eq(users.role, 'admin'));
          const role = adminCount[0].count === 0 ? 'admin' : 'user';

          // Create new user with appropriate role
          // Use email prefix as default name
          const defaultName = email.split('@')[0];
          const newUserId = generateUUID();
          await db.insert(users).values({
            id: newUserId,
            email,
            name: defaultName,
            emailVerified: new Date(),
            role
          });
          user = await db
            .select()
            .from(users)
            .where(eq(users.id, newUserId))
            .limit(1);
        } else if (!user[0].emailVerified) {
          // Mark email as verified
          await db
            .update(users)
            .set({ emailVerified: new Date() })
            .where(eq(users.id, user[0].id));
        }

        return user[0]
          ? {
              id: user[0].id,
              email: user[0].email,
              name: user[0].name,
              role: user[0].role
            }
          : null;
      }
    })
  ],
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens
  }),
  session: {
    strategy: 'jwt'
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.image = user.image;
        token.admin = user.role === 'admin';
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.admin = token.admin as boolean;
      }
      return session;
    },
    /**
     * The middleware gate (see proxy.ts) — the only thing standing in front of
     * the app's pages, so a stale session has to be rejected here or the user
     * lands on a rendered page whose every data call 401s, with nothing telling
     * them to sign in again.
     *
     * A signature-valid JWT is not enough: it can outlive the user row it names
     * (account deleted, or DATABASE_URL repointed). Returning false sends them
     * to the sign-in page. Only ever runs in the proxy, which Next always
     * executes on the Node.js runtime, so any driver works here.
     */
    async authorized({ auth }) {
      if (!auth?.user?.id) return false;

      const [account] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.user.id))
        .limit(1);

      return !!account;
    }
  },
  events: {
    async createUser({ user }) {
      // OAuth 用户创建时检查并设置管理员角色
      if (user.id) {
        const adminCount = await db
          .select({ count: count() })
          .from(users)
          .where(eq(users.role, 'admin'));

        if (adminCount[0].count === 0) {
          await db
            .update(users)
            .set({ role: 'admin' })
            .where(eq(users.id, user.id));
        }
      }
    }
  },
  pages: {
    signIn: '/login'
  }
});

const auth = cache(uncachedAuth);

export { auth };

/**
 * The session, re-checked against the database.
 *
 * `auth()` alone cannot answer "is this user still allowed in?". Sessions are
 * JWTs (`session.strategy = 'jwt'`), so a token is accepted purely on its
 * signature and expiry — the adapter is consulted at sign-in and never again.
 * Three consequences, all of which this fixes:
 *
 * - A deleted user keeps a working session until the token expires, and their
 *   writes fail late with a foreign-key error instead of a clean 401.
 * - `token.admin` is a snapshot taken at sign-in, so demoting an admin does
 *   not take effect until they sign out. That is a privilege-escalation
 *   window, not just staleness.
 * - Repointing DATABASE_URL leaves every existing cookie referring to rows
 *   that no longer exist.
 *
 * Returns null when the user is gone, so callers treat a stale session exactly
 * like being signed out. `role` is read from the database and overrides the
 * token's copy. One query per request, deduped by `cache`.
 *
 * NOTE: deliberately separate from `auth`, which `proxy.ts` re-exports as the
 * edge middleware — that binding is called with (request, ctx) and must stay a
 * plain pass-through.
 */
export const getVerifiedSession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [account] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!account) return null;

  return {
    ...session,
    user: { ...session.user, admin: account.role === 'admin' }
  };
});
