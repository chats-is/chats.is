import { createFileRoute } from '@tanstack/react-router';

import Quotas from '@/components/console/quotas';

export const Route = createFileRoute('/console/quotas')({
  head: () => ({ meta: [{ title: 'Quotas' }] }),
  component: Quotas
});
