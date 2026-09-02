import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ArtifactProvider } from '@/contexts/artifact-context';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { requireUser } from '@/server/fn/auth';
import { getSystemSettingsFn } from '@/server/fn/settings';
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
  beforeLoad: async ({ location }) => {
    const user = await requireUser();
    if (!user) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    return { user };
  },
  loader: () => getSystemSettingsFn(),
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
