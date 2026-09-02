import { createFileRoute } from '@tanstack/react-router';

import Models from '@/components/console/models';

export const Route = createFileRoute('/console/models')({
  head: () => ({ meta: [{ title: 'Models' }] }),
  component: Models
});
