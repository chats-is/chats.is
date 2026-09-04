import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/fn/model';
import { providerQueries } from '@/server/fn/provider';
import Models from '@/components/console/models';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  capability: z.string().optional(),
  q: z.string().optional()
});

export const Route = createFileRoute('/console/models')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(modelQueries.list({})),
      context.queryClient.ensureQueryData(providerQueries.list())
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Models') }] }),
  pendingComponent: () => <ConsoleTableSkeleton columns={7} />,
  component: Models
});
