import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { getSitePage } from '@/server/functions/settings';
import { SitePage } from '@/components/site-page';

export const Route = createFileRoute('/_site/about')({
  loader: () => getSitePage({ data: { page: 'about' } }),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'About') }]
  }),
  component: AboutPage
});

function AboutPage() {
  const { markdown } = Route.useLoaderData();
  return <SitePage markdown={markdown} />;
}
