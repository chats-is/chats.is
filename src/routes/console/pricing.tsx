import { createFileRoute } from '@tanstack/react-router';

import { pricingQueries } from '@/server/fn/pricing';
import Pricing from '@/components/console/pricing';

export const Route = createFileRoute('/console/pricing')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(pricingQueries.listWithModels({})),
  head: () => ({ meta: [{ title: 'Pricing' }] }),
  component: Pricing
});
