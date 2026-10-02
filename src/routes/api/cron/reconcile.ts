import { createFileRoute } from '@tanstack/react-router';

import { reconcileWithProcessors } from '@/server/services/subscription';

/**
 * The scheduled job that makes up for webhooks that never came: called once
 * a day (see `vercel.json`), it reads from the payment processors what the
 * app has not been told — subscriptions past their expiry, and the refunds
 * and disputes of recent payments.
 *
 * No session: the scheduler is the caller, and proves itself with
 * `CRON_SECRET` as a bearer token, as Vercel's cron does. Without the
 * secret set the job is off.
 */
export const Route = createFileRoute('/api/cron/reconcile')({
  server: { handlers: { GET } }
});

async function GET({ request }: { request: Request }) {
  // Imported here: importing `env` validates the whole environment.
  const { env } = await import('@/lib/env');
  if (!env.CRON_SECRET) {
    return Response.json({ error: 'Not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return Response.json(await reconcileWithProcessors());
}
