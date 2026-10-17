import '@tanstack/react-start/server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { tanstackStartCookies } from 'better-auth/tanstack-start';

import { sendVerificationCode } from '@/lib/email';
import { env } from '@/lib/env';
import { db } from '@/db';
import {
  accounts,
  rateLimits,
  sessions,
  users,
  verifications
} from '@/db/schema';
import { makeFirstUserAdmin } from '@/server/services/user';

/**
 * Two rules the app depends on, stated here because nothing else enforces them:
 *
 * - The first account on an empty install is an admin. Without it a fresh
 *   deploy has no way into /console.
 * - `role` is read from the user row on the request that uses the session, so
 *   revoking admin takes effect immediately rather than at token expiry.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Models resolve by the export name they are given, not the table name,
    // and these are exported plural.
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      rateLimit: rateLimits
    }
  }),
  // Kept in the database rather than in each server's memory, so the limits
  // hold across every instance a deploy runs. The rules are Better Auth's own.
  rateLimit: { storage: 'database' },
  ...(env.AUTH_IP_ADDRESS_HEADERS && {
    advanced: {
      ipAddress: {
        ipAddressHeaders: env.AUTH_IP_ADDRESS_HEADERS.split(',')
          .map(header => header.trim())
          .filter(Boolean)
      }
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
        // A sign-in by email code carries no name, and better-auth stores it
        // as empty — so the user would go by nothing anywhere a name is
        // shown. They go by their address's local part until they set one,
        // as migration 0020 named the accounts that came before. Names are
        // display names and may repeat; the email is what is unique.
        before: async user => {
          if (user.name.trim()) return;
          return { data: { ...user, name: user.email.split('@')[0] } };
        },
        after: user => makeFirstUserAdmin(user.id)
      }
    }
  }
});
