import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * What is public: read on both sides, and safe for either.
 *
 * Kept apart from the server's schema because a module the browser imports
 * pulls in whatever that schema names. No secret would survive the bundler —
 * `process.env` is replaced with nothing there — but the list of every
 * variable this app runs on has no business being shipped to a page.
 */
export const publicEnv = createEnv({
  clientPrefix: 'VITE_',
  client: {
    // The browser builds the path it uploads to, and the server checks that
    // path against the session before signing a token for it. Public because
    // it is already the first segment of every blob URL the app serves.
    VITE_UPLOAD_PATH: z.string().default('uploads')
  },
  runtimeEnv: {
    VITE_UPLOAD_PATH: import.meta.env?.VITE_UPLOAD_PATH
  },
  emptyStringAsUndefined: true
});
