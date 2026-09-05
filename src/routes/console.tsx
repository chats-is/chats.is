import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation
} from '@tanstack/react-router';
import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';

import { pageTitle } from '@/lib/head';
import { sessionQueries } from '@/server/fn/auth';
import { getSystemSettingsFn } from '@/server/fn/settings';
import { userQueries } from '@/server/fn/user';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { ConsoleHeader } from '@/components/console/header';
import { Sidebar } from '@/components/console/sidebar';
import { ConsoleContentSkeleton } from '@/components/console/skeletons';
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
 * alone.
 *
 * This wait covers the page's own, which has not been reached yet, so the
 * placeholder is chosen from the address being navigated to rather than left
 * as one shape for all of them — the home page is cards, and standing a table
 * in front of it only to swap is worse than not standing anything in.
 */
function ConsolePending() {
  const pathname = useLocation({ select: l => l.pathname });

  return (
    <ConsoleShell>
      <ConsoleContentSkeleton pathname={pathname} />
    </ConsoleShell>
  );
}

function ConsoleLayout() {
  const { settings } = Route.useLoaderData();

  return (
    <SystemSettingsProvider settings={settings}>
      <PreferencesProvider>
        <SettingsDialogProvider>
          <ConsoleShell>
            <Outlet />
          </ConsoleShell>
        </SettingsDialogProvider>
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
