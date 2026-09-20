import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageTitle } from '@/lib/head';
import { promptQueries } from '@/server/functions/prompt';
import {
  GalleryPending,
  PromptsToolbarSkeleton
} from '@/components/gallery-skeleton';
import { PromptsView } from '@/components/prompts-view';

/** Which tab is open lives in the address, so a link to My Prompts opens
 *  there directly and a refresh doesn't bounce back to Trending. Trending is
 *  the default, so it stays absent from an untouched URL. */
const searchSchema = z.object({
  tab: z.enum(['trending', 'my']).optional()
});

export const Route = createFileRoute('/_chat/prompts')({
  validateSearch: searchSchema,
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      promptQueries.usableInfinite({ limit: 24 })
    ),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompts') }] }),
  pendingComponent: () => (
    <GalleryPending title="Prompts" toolbar={<PromptsToolbarSkeleton />} />
  ),
  component: PromptsView
});
