import { createFileRoute } from '@tanstack/react-router';

import Pricing from '@/components/console/pricing';

export const Route = createFileRoute('/console/pricing')({
  head: () => ({ meta: [{ title: 'Pricing' }] }),
  component: Pricing
});
