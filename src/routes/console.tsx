import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { pageTitle } from '@/lib/head';
import { sessionQueries } from '@/server/fn/auth';
import { getSystemSettingsFn } from '@/server/fn/settings';
import { userQueries } from '@/server/fn/user';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { ConsoleHeader } from '@/components/console/header';
import { Sidebar } from '@/components/console/sidebar';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

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
      getSystemSettingsFn(),
      // The console header names the signed-in admin on every page.
      context.queryClient.ensureQueryData(userQueries.me())
    ]);
    return { settings };
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Console') }] }),
  pendingComponent: ConsolePending,
  component: ConsoleLayout
});

/**
 * The console's chrome. Neither the sidebar nor the header reads this route's
 * loader data — they need only the address and a static nav list — so the
 * shell can be on screen while the data behind it is still on the way.
 */
function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar />
      <SidebarInset className="h-svh">
        <ConsoleHeader />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * The wait for the console's own data. The shell is the real one, so what
 * arrives replaces the placeholder in the content area and leaves the chrome
 * alone. A table stands in for the page because most of the console is one;
 * a page shaped otherwise settles in when its own route resolves.
 */
function ConsolePending() {
  return (
    <ConsoleShell>
      <ConsoleTableSkeleton />
    </ConsoleShell>
  );
}

function ConsoleLayout() {
  const { settings } = Route.useLoaderData();

  return (
    <SystemSettingsProvider settings={settings}>
      <PreferencesProvider>
        <ConsoleShell>
          <Outlet />
        </ConsoleShell>
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
