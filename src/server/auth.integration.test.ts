import { makeTestDb } from '@/test/pg';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { accounts, sessions, users, verifications } from './db/schema';

/**
 * The auth stack against a real Postgres engine with the real migrations
 * applied — including the one that drops `email_verification_code`.
 *
 * That table belonged to a hand-rolled Credentials provider that no longer
 * exists; the emailOTP plugin keeps its codes in `verification` and owns the
 * length, expiry and attempt limit itself. These tests are what say so.
 *
 * `tanstackStartCookies` is deliberately absent: it writes Set-Cookie through
 * the request context, which does not exist outside a served request.
 */
type TestDb = Awaited<ReturnType<typeof makeTestDb>>['db'];

const sentCodes: Array<{ email: string; otp: string }> = [];

function makeAuth(db: TestDb) {
  return betterAuth({
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications
      }
    }),
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'user', input: false },
        planId: { type: 'string', required: false, input: false },
        quotaId: { type: 'string', required: false, input: false }
      }
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10,
        allowedAttempts: 5,
        sendVerificationOTP: async ({ email, otp }) => {
          sentCodes.push({ email, otp });
        }
      })
    ],
    databaseHooks: {
      user: {
        create: {
          after: async user => {
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
}

describe('better-auth over the migrated schema', () => {
  let db: TestDb;
  let auth: ReturnType<typeof makeAuth>;

  beforeEach(async () => {
    sentCodes.length = 0;
    ({ db } = await makeTestDb());
    auth = makeAuth(db);
  });

  it('stores an emailed code in verification, not the dropped table', async () => {
    await auth.api.sendVerificationOTP({
      body: { email: 'first@test.com', type: 'sign-in' }
    });

    expect(sentCodes).toHaveLength(1);
    expect(sentCodes[0].otp).toMatch(/^\d{6}$/);

    const rows = await db.select().from(verifications);
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('signs a user in with an emailed code', async () => {
    await auth.api.sendVerificationOTP({
      body: { email: 'first@test.com', type: 'sign-in' }
    });

    const signedIn = await auth.api.signInEmailOTP({
      body: { email: 'first@test.com', otp: sentCodes[0].otp },
      asResponse: true
    });

    expect(signedIn.status).toBe(200);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it('promotes the first user to admin and leaves the second alone', async () => {
    for (const email of ['first@test.com', 'second@test.com']) {
      await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } });
      const { otp } = sentCodes[sentCodes.length - 1];
      await auth.api.signInEmailOTP({ body: { email, otp } });
    }

    const rows = await db
      .select({ email: users.email, role: users.role })
      .from(users);

    expect(rows.find(r => r.email === 'first@test.com')?.role).toBe('admin');
    expect(rows.find(r => r.email === 'second@test.com')?.role).toBe('user');
  });

  it('reads role from the database, so demotion takes effect at once', async () => {
    await auth.api.sendVerificationOTP({
      body: { email: 'first@test.com', type: 'sign-in' }
    });

    // Take the cookie from the response rather than building one: better-auth
    // signs the session cookie, so a hand-assembled value is rejected the same
    // way a forged one would be.
    const signedIn = await auth.api.signInEmailOTP({
      body: { email: 'first@test.com', otp: sentCodes[0].otp },
      asResponse: true
    });
    const setCookie = signedIn.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const headers = new Headers({ cookie: setCookie!.split(';')[0] });

    expect((await auth.api.getSession({ headers }))?.user.role).toBe('admin');

    await db
      .update(users)
      .set({ role: 'user' })
      .where(eq(users.email, 'first@test.com'));

    // NextAuth could not do this: `admin` was baked into a signed JWT at
    // sign-in, so a demoted admin kept their privileges until it expired.
    expect((await auth.api.getSession({ headers }))?.user.role).toBe('user');
  });

  it('stops accepting tries after the limit, even a correct one', async () => {
    await auth.api.sendVerificationOTP({
      body: { email: 'first@test.com', type: 'sign-in' }
    });
    const { otp } = sentCodes[0];
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        auth.api.signInEmailOTP({
          body: { email: 'first@test.com', otp: wrong }
        })
      ).rejects.toThrow();
    }

    // The hand-rolled provider this replaces counted attempts the same way,
    // and that limit had to survive the move.
    await expect(
      auth.api.signInEmailOTP({ body: { email: 'first@test.com', otp } })
    ).rejects.toThrow();

    expect(await db.select().from(users)).toHaveLength(0);
  });
});
