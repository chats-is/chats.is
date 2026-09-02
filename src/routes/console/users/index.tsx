import { createFileRoute } from '@tanstack/react-router';

import Users from '@/components/console/users';

export const Route = createFileRoute('/console/users/')({
  head: () => ({ meta: [{ title: 'Users' }] }),
  component: Users
});
