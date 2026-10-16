import { createFileRoute, notFound } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { getSharedArtifactPage } from '@/server/functions/share';
import { RoutePending } from '@/components/route-pending';
import { EmbeddedArtifactView } from '@/components/shared-artifact-view';

/**
 * An artifact shared on its own, as another site embeds it: the same link as
 * its page, and the same nothing of the chat it came from. One of the two
 * kinds of page any site may frame (`src/start.ts`).
 */
export const Route = createFileRoute('/embed/$id')({
  loader: async ({ params }) => {
    const page = await getSharedArtifactPage({ data: { id: params.id } });

    if (!page) {
      throw notFound();
    }

    return page;
  },
  head: ({ matches, loaderData }) => ({
    meta: [
      { title: pageTitle(matches, loaderData?.artifact.title ?? undefined) },
      { name: 'robots', content: 'noindex' }
    ]
  }),
  pendingComponent: RoutePending,
  component: EmbeddedArtifactPage
});

function EmbeddedArtifactPage() {
  const { artifact, files } = Route.useLoaderData();

  return <EmbeddedArtifactView artifact={artifact} files={files} />;
}
