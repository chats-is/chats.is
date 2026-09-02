import { createFileRoute } from '@tanstack/react-router';

import Usage from '@/components/console/usage';

export const Route = createFileRoute('/console/usage')({
  head: () => ({ meta: [{ title: 'Usage' }] }),
  component: Usage
});
