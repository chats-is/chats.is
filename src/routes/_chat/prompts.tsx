import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { promptQueries } from '@/server/fn/prompt';
import { RoutePending } from '@/components/route-pending';
import { PromptsView } from '@/components/prompts-view';

export const Route = createFileRoute('/_chat/prompts')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(promptQueries.usable()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompts') }] }),
  pendingComponent: RoutePending,
  component: PromptsView
});
