import { createFileRoute } from '@tanstack/react-router';

import { modelQueries } from '@/server/fn/model';
import { providerQueries } from '@/server/fn/provider';
import Models from '@/components/console/models';

export const Route = createFileRoute('/console/models')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(modelQueries.list({})),
      context.queryClient.ensureQueryData(providerQueries.list())
    ]),
  head: () => ({ meta: [{ title: 'Models' }] }),
  component: Models
});
