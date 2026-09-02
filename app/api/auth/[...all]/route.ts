import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/server/auth';

/**
 * Everything the auth library serves: sign-in, sign-out, the OAuth callbacks,
 * and the emailed one-time code — which is why the hand-written send-code
 * route this replaced is gone. The code is now issued and checked by the same
 * plugin that signs the user in.
 */
export const { GET, POST } = toNextJsHandler(auth);
