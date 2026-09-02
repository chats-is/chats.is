import { defineConfig } from 'drizzle-kit';

import { env } from '@/lib/env';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL
  }
});
