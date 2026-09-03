import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { pageTitle } from '@/lib/head';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { sessionQueries } from '@/server/fn/auth';
import { getSystemSettingsFn } from '@/server/fn/settings';
import { userQueries } from '@/server/fn/user';
import { RoutePending } from '@/components/route-pending';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { ConsoleHeader } from '@/components/console/header';
import { Sidebar } from '@/components/console/sidebar';

const getAppName = createServerFn({ method: 'GET' }).handler(async () => {
  const { getAppSettings } = await import('@/lib/queries');
  const { appName } = await getAppSettings();
  return appName;
});

/**
 * The console is admin-only, and says so once here. `role` is read from the
 * user row on this request, so an admin who was just demoted is turned away
 * now rather than when a token would have expired.
 */
export const Route = createFileRoute('/console')({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData(
      sessionQueries.me()
    );
    if (!user?.admin) {
      throw redirect({ to: '/' });
    }
    return { user };
  },
  loader: async ({ context }) => {
    const [settings, appName] = await Promise.all([
      getSystemSettingsFn(),
      getAppName(),
      // The console header names the signed-in admin on every page.
      context.queryClient.ensureQueryData(userQueries.me())
    ]);
    return { settings, appName };
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
        <SidebarProvider>
          <Sidebar />
          <SidebarInset className="h-svh">
            <ConsoleHeader />
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
