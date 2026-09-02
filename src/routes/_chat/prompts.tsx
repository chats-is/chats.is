import { createFileRoute } from '@tanstack/react-router';

import { promptQueries } from '@/server/fn/prompt';
import { PromptsView } from '@/components/prompts-view';

export const Route = createFileRoute('/_chat/prompts')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(promptQueries.usable()),
  head: () => ({ meta: [{ title: 'Prompts' }] }),
  component: PromptsView
});
