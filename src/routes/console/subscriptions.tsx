import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { subscriptionQueries } from '@/server/functions/subscription';
import Subscriptions, {
  SubscriptionsPending
} from '@/components/console/subscriptions';
import { subscriptionTableInput } from '@/components/console/table-filters';

/** Filters live in the address, so a filtered view can be linked. Each is
 *  optional: one at its default is simply absent. */
const searchSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  processor: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/subscriptions')({
  validateSearch: searchSchema,
  // The first page, under the key the component asks for on a plain visit.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      subscriptionQueries.list(subscriptionTableInput({}))
    ),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Subscriptions') }]
  }),
  pendingComponent: SubscriptionsPending,
  component: Subscriptions
});
