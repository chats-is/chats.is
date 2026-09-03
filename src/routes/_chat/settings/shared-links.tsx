import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { shareQueries } from '@/server/fn/share';
import { RoutePending } from '@/components/route-pending';
import { SharedLinks } from '@/components/shared-links';

export const Route = createFileRoute('/_chat/settings/shared-links')({
  loader: ({ context }) =>
    // Same page as useSharedLinks asks for by default — a different one is a
    // different cache entry, and the loader would be filling one nothing reads.
    context.queryClient.ensureQueryData(
      shareQueries.list({ limit: 5, offset: 0 })
    ),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Shared Links Settings') }] }),
  pendingComponent: RoutePending,
  component: SharedLinks
});
