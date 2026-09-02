import { createFileRoute } from '@tanstack/react-router';

import { modelQueries } from '@/server/fn/model';
import Usage from '@/components/console/usage';

export const Route = createFileRoute('/console/usage')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(modelQueries.list({})),
  head: () => ({ meta: [{ title: 'Usage' }] }),
  component: Usage
});
