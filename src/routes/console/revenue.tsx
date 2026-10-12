import { createFileRoute } from '@tanstack/react-router';

import { pageSearchSchema } from '@/types/pagination';
import { reportWindowSearchSchema } from '@/types/usage';
import { pageTitle } from '@/lib/head';
import Revenue, { RevenuePending } from '@/components/console/revenue';

export const Route = createFileRoute('/console/revenue')({
  // The window lives in the address, so a view can be linked.
  validateSearch: reportWindowSearchSchema.extend({ page: pageSearchSchema }),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Revenue') }] }),
  pendingComponent: RevenuePending,
  component: Revenue
});
