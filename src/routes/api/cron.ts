import { createFileRoute } from '@tanstack/react-router';

import { runScheduledJob } from '@/server/services/subscription';

/**
 * The scheduled job: the recovery for what the webhooks did not say, called
 * once a day (see `vercel.json`). Subscriptions past their period end are asked
 * of their processor; those whose renewal failed and whose grace days are
 * over are ended; refunds sent from here and still waiting after a day are
 * asked of their processor by id.
 *
 * No session: the scheduler is the caller, and proves itself with
 * `CRON_SECRET` as a bearer token, as Vercel's cron does. Without the
 * secret set the job is off.
 */
export const Route = createFileRoute('/api/cron')({
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
  return Response.json(await runScheduledJob());
}
