import { createFileRoute } from '@tanstack/react-router';

import { modelQueries } from '@/server/fn/model';
import { promptQueries } from '@/server/fn/prompt';
import Prompts from '@/components/console/prompts';

export const Route = createFileRoute('/console/prompts')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(promptQueries.adminList()),
      context.queryClient.ensureQueryData(modelQueries.list({}))
    ]),
  head: () => ({ meta: [{ title: 'Prompts' }] }),
  component: Prompts
});
