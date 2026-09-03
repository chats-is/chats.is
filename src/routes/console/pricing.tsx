import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageTitle } from '@/lib/head';
import { pricingQueries } from '@/server/fn/pricing';
import { RoutePending } from '@/components/route-pending';
import Pricing from '@/components/console/pricing';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  capability: z.string().optional(),
  q: z.string().optional()
});

export const Route = createFileRoute('/console/pricing')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(pricingQueries.listWithModels({})),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Pricing') }] }),
  pendingComponent: RoutePending,
  component: Pricing
});
