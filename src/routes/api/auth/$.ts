import { createFileRoute } from '@tanstack/react-router';

import { auth } from '@/server/auth';

/** Every better-auth endpoint — OAuth callbacks, OTP, session reads. */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request)
    }
  }
});
