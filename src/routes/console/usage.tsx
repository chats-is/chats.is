import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/functions/model';
import Usage, { UsagePending } from '@/components/console/usage';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  days: z.coerce.number().int().positive().optional(),
  user: z.string().optional(),
  model: z.string().optional(),
  capability: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/usage')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.forSelect()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Usage') }] }),
  pendingComponent: UsagePending,
  component: Usage
});
