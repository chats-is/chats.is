import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { count, eq } from 'drizzle-orm';

import { sendVerificationCode } from '@/lib/email';
import { env } from '@/lib/env';

import { db } from './db';
import { accounts, sessions, users, verifications } from './db/schema';

/**
 * Two rules the app depends on, stated here because nothing else enforces them:
 *
 * - The first account on an empty install is an admin. Without it a fresh
 *   deploy has no way into /console.
 * - `role` is read from the user row on the request that uses the session, so
 *   revoking admin takes effect immediately rather than at token expiry.
 */
export const auth = betterAuth({
  secret: env.AUTH_SECRET,
  // Inferring the origin from the request breaks OAuth callbacks behind a
  // proxy, so it is stated.
  baseURL: env.VERCEL_URL
    ? `https://${env.VERCEL_URL}`
    : `http://localhost:${env.PORT ?? 3000}`,
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Models resolve by the export name they are given, not the table name,
    // and these are exported plural.
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications
    }
  }),
  user: {
    additionalFields: {
      // `input: false` keeps these off anything a client can send — a sign-up
      // must not be able to ask for a role or a plan.
      role: { type: 'string', defaultValue: 'user', input: false },
      planId: { type: 'string', required: false, input: false },
      quotaId: { type: 'string', required: false, input: false }
    }
  },
  socialProviders: {
    ...(env.AUTH_GOOGLE_ENABLED && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET
      ? {
          google: {
            clientId: env.AUTH_GOOGLE_ID,
            clientSecret: env.AUTH_GOOGLE_SECRET
          }
        }
      : {}),
    ...(env.AUTH_GITHUB_ENABLED && env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET
      ? {
          github: {
            clientId: env.AUTH_GITHUB_ID,
            clientSecret: env.AUTH_GITHUB_SECRET
          }
        }
      : {})
  },
  // Signing in with a provider carrying an already-known verified email links
  // to that account instead of creating a second user.
  account: {
    accountLinking: { enabled: true, trustedProviders: ['google', 'github'] }
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 10,
      allowedAttempts: 5,
      sendVerificationOTP: async ({ email, otp }) => {
        await sendVerificationCode(email, otp);
      }
    }),
    // Last: it writes Set-Cookie through the request context.
    tanstackStartCookies()
  ],
  databaseHooks: {
    user: {
      create: {
        after: async user => {
          // Counted rather than assumed, so it stays correct if the first
          // admin is later demoted and someone else signs up.
          const [admins] = await db
            .select({ value: count() })
            .from(users)
            .where(eq(users.role, 'admin'));

          if (admins?.value === 0) {
            await db
              .update(users)
              .set({ role: 'admin' })
              .where(eq(users.id, user.id));
          }
        }
      }
    }
  }
});
