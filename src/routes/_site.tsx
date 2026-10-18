import { createFileRoute, Outlet } from '@tanstack/react-router';

import { sessionQueries } from '@/server/functions/auth';
import { SiteLayout } from '@/components/site-layout';

/**
 * The site's public pages — about, the legal pages and signing in — open to
 * anyone, signed in or not. The front page is `/` itself, which the chat
 * layout gives to a visitor who is not signed in, in the same frame.
 */
export const Route = createFileRoute('/_site')({
  // Whether someone is signed in decides what the header offers: the app,
  // or the way in.
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueries.me());
  },
  component: () => (
    <SiteLayout>
      <Outlet />
    </SiteLayout>
  )
});
