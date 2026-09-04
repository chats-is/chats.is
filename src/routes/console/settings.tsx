import { createFileRoute, Outlet } from '@tanstack/react-router';

import { settingsQueries } from '@/server/fn/settings';
import { ConsoleSettingsNav } from '@/components/console/settings-nav';
import { ConsoleSettingsPanelSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/settings')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(settingsQueries.list()),
  pendingComponent: SettingsPending,
  component: ConsoleSettingsLayout
});

/** The nav is a static list, so it is the real one either side of the wait. */
function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0 lg:flex-row">
      <ConsoleSettingsNav />
      <div className="min-w-0 flex-1 lg:pl-8">{children}</div>
    </div>
  );
}

function SettingsPending() {
  return (
    <SettingsShell>
      <ConsoleSettingsPanelSkeleton />
    </SettingsShell>
  );
}

function ConsoleSettingsLayout() {
  return (
    <SettingsShell>
      <Outlet />
    </SettingsShell>
  );
}
