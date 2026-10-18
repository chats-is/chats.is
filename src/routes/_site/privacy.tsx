import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { getSitePage } from '@/server/functions/settings';
import { SitePage } from '@/components/site-page';

export const Route = createFileRoute('/_site/privacy')({
  loader: () => getSitePage({ data: { page: 'privacy' } }),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Privacy Policy') }]
  }),
  component: PrivacyPage
});

function PrivacyPage() {
  const { markdown } = Route.useLoaderData();
  return <SitePage markdown={markdown} />;
}
