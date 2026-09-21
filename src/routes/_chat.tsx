import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ArtifactProvider } from '@/contexts/artifact-context';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { sessionQueries } from '@/server/functions/auth';
import { chatQueries } from '@/server/functions/chat';
import { settingsQueries } from '@/server/functions/settings';
import { userQueries } from '@/server/functions/user';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { RoutePending } from '@/components/route-pending';
import { SettingsDialogProvider } from '@/components/settings-dialog';
import { Sidebar } from '@/components/sidebar';

/**
 * Everything a signed-in user sees sits under here: the chat itself, the
 * library, prompts and settings. The guard is stated once, at the top of the
 * subtree, rather than by each page — and it runs before any of their loaders,
 * so a signed-out visitor is sent to sign in instead of watching a page render
 * whose every read would then be refused.
 */
// The wait for this subtree is the wait for the shell itself: until the guard
// has answered and the settings are in, there is no sidebar to keep and no page
// to put beside it. Once the shell is up the pages below wait on their own.
export const Route = createFileRoute('/_chat')({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueries.me());
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    return { user };
  },
  // The user menu sits on every page under here, so the signed-in user is
  // resolved with the rest of this subtree's data rather than fetched again
  // from the browser once the page has already drawn. The sidebar's history
  // is here for the same reason: it is not read during a server render, so
  // left to the component it would arrive as placeholders and a second trip.
  loader: async ({ context }) => {
    const [settings] = await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.system()),
      context.queryClient.ensureQueryData(userQueries.me()),
      // Primed, not required. The sidebar reports a failed read of its own;
      // letting it fail here would replace the whole app with an error page
      // over a list the reader may not even be looking at.
      context.queryClient
        .ensureInfiniteQueryData(chatQueries.history())
        .catch(() => undefined)
    ]);
    return settings;
  },
  pendingComponent: RoutePending,
  component: ChatLayout
});

function ChatLayout() {
  const settings = Route.useLoaderData();

  return (
    <SystemSettingsProvider settings={settings}>
      <PreferencesProvider>
        <ArtifactProvider>
          <SettingsDialogProvider>
            <SidebarProvider className="h-svh overflow-hidden">
              <Sidebar />
              <SidebarInset className="h-full overflow-hidden">
                <Outlet />
              </SidebarInset>
            </SidebarProvider>
          </SettingsDialogProvider>
        </ArtifactProvider>
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
