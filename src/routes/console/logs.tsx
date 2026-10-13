import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { reportWindowSearchSchema } from '@/types/usage';
import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import Logs, { LogsPending } from '@/components/console/logs';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = reportWindowSearchSchema.extend({
  user: z.string().optional(),
  model: z.string().optional(),
  capability: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/logs')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.forSelect()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Logs') }] }),
  pendingComponent: LogsPending,
  component: Logs
});
