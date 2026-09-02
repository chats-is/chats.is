import { createFileRoute } from '@tanstack/react-router';

import Plans from '@/components/console/plans';

export const Route = createFileRoute('/console/plans')({
  head: () => ({ meta: [{ title: 'Plans' }] }),
  component: Plans
});
