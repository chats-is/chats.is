import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ArtifactProvider } from '@/contexts/artifact-context';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { sessionQueries } from '@/server/fn/auth';
import { getSystemSettingsFn } from '@/server/fn/settings';
import { userQueries } from '@/server/fn/user';
import { RoutePending } from '@/components/route-pending';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Sidebar } from '@/components/sidebar';

/**
 * Everything a signed-in user sees sits under here: the chat itself, the
 * library, prompts and settings. The guard is stated once, at the top of the
 * subtree, rather than by each page — and it runs before any of their loaders,
 * so a signed-out visitor is sent to sign in instead of watching a page render
 * whose every read would then be refused.
 */
export const Route = createFileRoute('/_chat')({
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(
      sessionQueries.me()
    );
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    return { user };
  },
  // The user menu sits on every page under here, so the signed-in user is
  // resolved with the rest of this subtree's data rather than fetched again
  // from the browser once the page has already drawn.
  loader: async ({ context }) => {
    const [settings] = await Promise.all([
      getSystemSettingsFn(),
      context.queryClient.ensureQueryData(userQueries.me())
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
          <SidebarProvider className="h-svh overflow-hidden">
            <Sidebar />
            <SidebarInset className="h-full overflow-hidden">
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        </ArtifactProvider>
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
