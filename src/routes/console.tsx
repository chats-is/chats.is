import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { requireUser } from '@/server/fn/auth';
import { getSystemSettingsFn } from '@/server/fn/settings';
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
  beforeLoad: async () => {
    const user = await requireUser();
    if (!user?.admin) {
      throw redirect({ to: '/' });
    }
    return { user };
  },
  loader: async () => ({
    settings: await getSystemSettingsFn(),
    appName: await getAppName()
  }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.appName ?? 'chats.is'} Console` }]
  }),
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
