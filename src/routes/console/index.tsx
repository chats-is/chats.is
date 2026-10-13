import { createFileRoute } from '@tanstack/react-router';

import { reportWindowSearchSchema } from '@/types/usage';
import { pageTitle } from '@/lib/head';
import Overview, { OverviewPending } from '@/components/console/overview';

export const Route = createFileRoute('/console/')({
  // The window lives in the address, so a view can be linked.
  validateSearch: reportWindowSearchSchema,
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Console') }] }),
  pendingComponent: OverviewPending,
  component: Overview
});
