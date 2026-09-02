import { createFileRoute } from '@tanstack/react-router';

import { quotaQueries } from '@/server/fn/quota';
import { usageQueries } from '@/server/fn/usage';
import UserDetail from '@/components/console/user-detail';

export const Route = createFileRoute('/console/users/$userId')({
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
  component: UserDetailPage
});

function UserDetailPage() {
  const { userId } = Route.useParams();

  return <UserDetail userId={userId} />;
}
