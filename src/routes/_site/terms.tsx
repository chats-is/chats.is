import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { getSitePage } from '@/server/functions/settings';
import { SitePage } from '@/components/site-page';

export const Route = createFileRoute('/_site/terms')({
  loader: () => getSitePage({ data: { page: 'terms' } }),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Terms of Service') }]
  }),
  component: TermsPage
});

function TermsPage() {
  const { markdown } = Route.useLoaderData();
  return <SitePage markdown={markdown} />;
}
