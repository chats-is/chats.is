import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { modelQueries } from '@/server/fn/model';
import { promptQueries } from '@/server/fn/prompt';
import { RoutePending } from '@/components/route-pending';
import { UserPrompt } from '@/components/user-prompt';

export const Route = createFileRoute('/_chat/settings/prompts')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(promptQueries.list()),
      context.queryClient.ensureQueryData(modelQueries.list({}))
    ]),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompt Settings') }] }),
  pendingComponent: RoutePending,
  component: UserPrompt
});
