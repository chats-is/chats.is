import { createFileRoute } from '@tanstack/react-router';

import Providers from '@/components/console/providers';

export const Route = createFileRoute('/console/providers')({
  head: () => ({ meta: [{ title: 'Providers' }] }),
  component: Providers
});
