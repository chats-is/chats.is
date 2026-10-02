import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * The one server module that does not say `server-only`. drizzle-kit reads it
 * through `drizzle.config.ts`, outside the build, and cannot load that marker.
 * Nothing is lost by it: read in a browser, any of these throws.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z
      .string()
      .optional()
      .refine(
        port => !port || (parseInt(port) > 0 && parseInt(port) < 65536),
        'Invalid port number'
      ),

    // Database
    DATABASE_URL: z
      .string()
      .refine(
        url => url.startsWith('postgres://') || url.startsWith('postgresql://'),
        'DATABASE_URL must start with postgres:// or postgresql://'
      ),

    // Auth
    // The origin the app answers from. better-auth reads this name from the
    // environment by itself; declared here so a value that is not a URL is
    // refused at startup rather than at the first sign-in.
    // http(s) said outright: `localhost:3000` is a URL to a parser — scheme
    // `localhost`, path `3000` — and is the mistake most likely to be made.
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }).optional(),
    AUTH_SECRET: z.string(),
    APP_SECRET: z.string().min(1),

    // GitHub Auth
    AUTH_GITHUB_ENABLED: z.coerce.boolean().default(false),
    AUTH_GITHUB_ID: z.string().optional(),
    AUTH_GITHUB_SECRET: z.string().optional(),

    // Google Auth
    AUTH_GOOGLE_ENABLED: z.coerce.boolean().default(false),
    AUTH_GOOGLE_ID: z.string().optional(),
    AUTH_GOOGLE_SECRET: z.string().optional(),

    // Email Auth
    AUTH_EMAIL_ENABLED: z.coerce.boolean().default(false),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),

    // Blob Store
    BLOB_READ_WRITE_TOKEN: z.string().min(1),

    // Resumable chat streams (optional). When unset, resume is disabled and
    // chat falls back to one-shot streaming. Use an Upstash Redis `rediss://`
    // URL (or any Redis URL).
    REDIS_URL: z.string().optional(),

    // Analytics
    UMAMI_SCRIPT_URL: z.string().optional(),
    UMAMI_WEBSITE_ID: z.string().optional(),

    // Stripe's keys. Only credentials: the subscriptions feature is switched
    // in the console, and without these a Stripe call fails and says why.
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Paddle's keys, the same: credentials only. The client-side token is
    // what Paddle.js opens its checkout with, on the app's own page; a
    // sandbox token (`test_…`) puts both on Paddle's sandbox.
    PADDLE_API_KEY: z.string().optional(),
    PADDLE_WEBHOOK_SECRET: z.string().optional(),
    PADDLE_CLIENT_TOKEN: z.string().optional(),

    // Lemon Squeezy's keys, and the store its prices are sold from. Test
    // mode is the key's own: a test-mode key works on test-mode data.
    LEMONSQUEEZY_API_KEY: z.string().optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET: z.string().optional(),
    LEMONSQUEEZY_STORE_ID: z.string().optional(),

    // What the scheduled job at /api/cron/reconcile is called with, as a
    // bearer token. Unset, the job is off.
    CRON_SECRET: z.string().optional()
  },
  // process.env is what the server, drizzle-kit and the deployed function all
  // see, so one schema serves the three.
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,

    // Database
    DATABASE_URL: process.env.DATABASE_URL,

    // Auth
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_SECRET: process.env.APP_SECRET,

    // GitHub Auth
    AUTH_GITHUB_ENABLED: process.env.AUTH_GITHUB_ENABLED === 'true',
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,

    // Google Auth
    AUTH_GOOGLE_ENABLED: process.env.AUTH_GOOGLE_ENABLED === 'true',
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,

    // Email Auth
    AUTH_EMAIL_ENABLED: process.env.AUTH_EMAIL_ENABLED === 'true',
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,

    // Blob Store
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,

    // Resumable chat streams
    REDIS_URL: process.env.REDIS_URL,

    // Analytics
    UMAMI_SCRIPT_URL: process.env.UMAMI_SCRIPT_URL,
    UMAMI_WEBSITE_ID: process.env.UMAMI_WEBSITE_ID,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    PADDLE_API_KEY: process.env.PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,
    PADDLE_CLIENT_TOKEN: process.env.PADDLE_CLIENT_TOKEN,
    LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY,
    LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET,
    LEMONSQUEEZY_STORE_ID: process.env.LEMONSQUEEZY_STORE_ID,
    CRON_SECRET: process.env.CRON_SECRET
  },
  // `.env.example` lists every name with nothing after it, and a copy of it
  // leaves most that way. Empty means unset, not an invalid value.
  emptyStringAsUndefined: true
});
