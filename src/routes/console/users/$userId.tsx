import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { reportWindowSearchSchema } from '@/types/usage';
import { pageTitle } from '@/lib/head';
import { quotaQueries } from '@/server/functions/quota';
import { tierQueries } from '@/server/functions/tier';
import { usageQueries } from '@/server/functions/usage';
import UserDetail, {
  UserDetailSkeleton
} from '@/components/console/user-detail';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = reportWindowSearchSchema.extend({
  model: z.string().optional(),
  capability: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/users/$userId')({
  validateSearch: searchSchema,
  // Only what the route parameter alone decides. The usage figures are cut by
  // a window the page picks after it mounts, so they stay with the component.
  loader: ({ context, params }) => {
    // The tiers fill a select on the page; nothing waits to know them.
    void context.queryClient.prefetchQuery(tierQueries.listForSelect());
    return Promise.all([
      context.queryClient.ensureQueryData(
        quotaQueries.byUser({ userId: params.userId })
      ),
      context.queryClient.ensureQueryData(
        usageQueries.userModels({ userId: params.userId })
      )
    ]);
  },
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'User usage limits') }]
  }),
  pendingComponent: UserDetailSkeleton,
  component: UserDetailPage
});

function UserDetailPage() {
  const { userId } = Route.useParams();

  return <UserDetail userId={userId} />;
}
