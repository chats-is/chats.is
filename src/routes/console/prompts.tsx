import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/fn/model';
import { promptQueries } from '@/server/fn/prompt';
import Prompts from '@/components/console/prompts';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  q: z.string().optional()
});

export const Route = createFileRoute('/console/prompts')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(promptQueries.adminList()),
      context.queryClient.ensureQueryData(modelQueries.list({}))
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompts') }] }),
  pendingComponent: () => <ConsoleTableSkeleton columns={7} />,
  component: Prompts
});
