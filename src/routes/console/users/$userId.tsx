import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { loadForVisit } from '@/lib/route-loader';
import { quotaQueries } from '@/server/functions/quota';
import { usageQueries } from '@/server/functions/usage';
import { ConsoleUsageSkeleton } from '@/components/console/skeletons';
import UserDetail from '@/components/console/user-detail';

/** Filters live in the address, so a filtered view can be linked, refreshed
 *  and come back to. Each is optional: a filter at its default is simply
 *  absent, which keeps an unfiltered page's URL clean. */
const searchSchema = z.object({
  days: z.coerce.number().int().positive().optional(),
  model: z.string().optional(),
  capability: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/users/$userId')({
  validateSearch: searchSchema,
  // Only what the route parameter alone decides. The usage figures are cut by
  // a window the page picks after it mounts, so they stay with the component.
  loader: ({ context, params, cause }) =>
    Promise.all([
      loadForVisit(
        context.queryClient,
        quotaQueries.byUser({ userId: params.userId }),
        cause
      ),
      loadForVisit(
        context.queryClient,
        usageQueries.userModels({ userId: params.userId }),
        cause
      )
    ]),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'User usage limits') }]
  }),
  pendingComponent: () => <ConsoleUsageSkeleton columns={5} />,
  component: UserDetailPage
});

function UserDetailPage() {
  const { userId } = Route.useParams();

  return <UserDetail userId={userId} />;
}
