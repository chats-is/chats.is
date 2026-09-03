import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { quotaQueries } from '@/server/fn/quota';
import { usageQueries } from '@/server/fn/usage';
import { RoutePending } from '@/components/route-pending';
import UserDetail from '@/components/console/user-detail';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  days: z.coerce.number().int().positive().optional(),
  model: z.string().optional(),
  capability: z.string().optional(),
  page: z.coerce.number().int().positive().optional()
});

export const Route = createFileRoute('/console/users/$userId')({
  validateSearch: searchSchema,
  // Only what the route parameter alone decides. The usage figures are cut by
  // a window the page picks after it mounts, so they stay with the component.
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        quotaQueries.byUser({ userId: params.userId })
      ),
      context.queryClient.ensureQueryData(
        usageQueries.userModels({ userId: params.userId })
      )
    ]),
  head: () => ({ meta: [{ title: 'User usage limits' }] }),
  pendingComponent: RoutePending,
  component: UserDetailPage
});

function UserDetailPage() {
  const { userId } = Route.useParams();

  return <UserDetail userId={userId} />;
}
