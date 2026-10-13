import { createFileRoute } from '@tanstack/react-router';

import { reportWindowSearchSchema } from '@/types/usage';
import { pageTitle } from '@/lib/head';
import Usage, { UsagePending } from '@/components/console/usage';

export const Route = createFileRoute('/console/usage')({
  // The window lives in the address, so a view can be linked.
  validateSearch: reportWindowSearchSchema,
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Usage') }] }),
  pendingComponent: UsagePending,
  component: Usage
});
