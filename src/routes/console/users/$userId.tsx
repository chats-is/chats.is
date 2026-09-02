import { createFileRoute } from '@tanstack/react-router';

import UserDetail from '@/components/console/user-detail';

export const Route = createFileRoute('/console/users/$userId')({
  head: () => ({ meta: [{ title: 'User usage limits' }] }),
  component: UserDetailPage
});

function UserDetailPage() {
  const { userId } = Route.useParams();

  return <UserDetail userId={userId} />;
}
