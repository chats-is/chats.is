import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { promptQueries } from '@/server/functions/prompt';
import { GalleryPending } from '@/components/gallery-skeleton';
import { PromptsView } from '@/components/prompts-view';

export const Route = createFileRoute('/_chat/prompts')({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      promptQueries.usableInfinite({ limit: 24 })
    ),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompts') }] }),
  pendingComponent: () => <GalleryPending title="Prompts" />,
  component: PromptsView
});
