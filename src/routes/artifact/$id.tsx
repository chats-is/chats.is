import { createFileRoute, notFound } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { getSharedArtifactPage } from '@/server/functions/share';
import { RoutePending } from '@/components/route-pending';
import { SharedArtifactView } from '@/components/shared-artifact-view';

/**
 * One artifact on its own, as its share link opens it: public, with no guard
 * above it and none needed, and nothing of the chat it came from. Kept out
 * of search engines — a link is for whoever it was given to.
 */
export const Route = createFileRoute('/artifact/$id')({
  loader: async ({ params }) => {
    const artifact = await getSharedArtifactPage({ data: { id: params.id } });

    if (!artifact) {
      throw notFound();
    }

    return { artifact };
  },
  head: ({ matches, loaderData }) => ({
    meta: [
      { title: pageTitle(matches, loaderData?.artifact.title ?? undefined) },
      { name: 'robots', content: 'noindex' }
    ]
  }),
  pendingComponent: RoutePending,
  component: SharedArtifactPage
});

function SharedArtifactPage() {
  const { artifact } = Route.useLoaderData();

  return <SharedArtifactView artifact={artifact} />;
}
