import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { modelQueries } from '@/server/fn/model';
import { RoutePending } from '@/components/route-pending';
import Usage from '@/components/console/usage';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  days: z.coerce.number().int().positive().optional(),
  user: z.string().optional(),
  model: z.string().optional(),
  capability: z.string().optional(),
  page: z.coerce.number().int().positive().optional()
});

export const Route = createFileRoute('/console/usage')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.list({})),
  head: () => ({ meta: [{ title: 'Usage' }] }),
  pendingComponent: RoutePending,
  component: Usage
});
