import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

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
    VERCEL_URL: z.string().optional(),
    // The deployment's own stable domain. VERCEL_URL is a different address on
    // every deploy, so it cannot be what OAuth redirects come back to.
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
    // Set this when the site is reached at a domain Vercel does not name —
    // a custom domain, or somewhere else entirely.
    APP_URL: z.string().url().optional(),

    // Database
    DATABASE_URL: z
      .string()
      .refine(
        url => url.startsWith('postgres://') || url.startsWith('postgresql://'),
        'DATABASE_URL must start with postgres:// or postgresql://'
      ),

    // Auth
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

    // Upload Path

    // Resumable chat streams (optional). When unset, resume is disabled and
    // chat falls back to one-shot streaming. Use an Upstash Redis `rediss://`
    // URL (or any Redis URL).
    REDIS_URL: z.string().optional(),

    // Analytics
    UMAMI_SCRIPT_URL: z.string().optional(),
    UMAMI_WEBSITE_ID: z.string().optional()
  },
  client: {
    // The browser builds the path it uploads to, and the server checks that
    // path against the session before signing a token for it. Public because
    // it is already the first segment of every blob URL the app serves.
    NEXT_PUBLIC_UPLOAD_PATH: z.string().default('uploads')
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_UPLOAD_PATH: process.env.NEXT_PUBLIC_UPLOAD_PATH,
    PORT: process.env.PORT,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    APP_URL: process.env.APP_URL,

    // Database
    DATABASE_URL: process.env.DATABASE_URL,

    // Auth
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

    // Upload Path

    // Resumable chat streams
    REDIS_URL: process.env.REDIS_URL,

    // Analytics
    UMAMI_SCRIPT_URL: process.env.UMAMI_SCRIPT_URL,
    UMAMI_WEBSITE_ID: process.env.UMAMI_WEBSITE_ID
  }
});
