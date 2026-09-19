import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { pageTitle } from '@/lib/head';
import { sessionQueries } from '@/server/functions/auth';
import { settingsQueries } from '@/server/functions/settings';
import { userQueries } from '@/server/functions/user';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { ConsoleHeader } from '@/components/console/header';
import { Sidebar } from '@/components/console/sidebar';
import { RoutePending } from '@/components/route-pending';
import { SettingsDialogProvider } from '@/components/settings-dialog';

/**
 * The console is admin-only, and says so once here. `role` is read from the
 * user row on this request, so an admin who was just demoted is turned away
 * now rather than when a token would have expired.
 */
export const Route = createFileRoute('/console')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(sessionQueries.me());
    if (!user?.admin) {
      throw redirect({ to: '/' });
    }
    return { user };
  },
  loader: async ({ context }) => {
    const [settings] = await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.system()),
      // The console header names the signed-in admin on every page.
      context.queryClient.ensureQueryData(userQueries.me())
    ]);
    return { settings };
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Console') }] }),
  pendingComponent: RoutePending,
  component: ConsoleLayout
});

function ConsoleLayout() {
  const { settings } = Route.useLoaderData();

  return (
    <SystemSettingsProvider settings={settings}>
      <PreferencesProvider>
        <SettingsDialogProvider>
          <SidebarProvider>
            <Sidebar />
            {/* Exactly one viewport tall, and it says so: the header is meant to
                sit still while the page under it scrolls, so nothing inside is
                allowed to push this box taller than the screen. Without the
                clip a tall page scrolls the whole console — header included —
                and the reader gets a second scrollbar beside the one that is
                supposed to be there. */}
            <SidebarInset className="h-svh overflow-hidden">
              <ConsoleHeader />
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <Outlet />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </SettingsDialogProvider>
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
