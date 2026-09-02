import { createFileRoute, Outlet } from '@tanstack/react-router';

import { settingsQueries } from '@/server/fn/settings';
import { ConsoleSettingsNav } from '@/components/console/settings-nav';

export const Route = createFileRoute('/console/settings')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(settingsQueries.list()),
  component: ConsoleSettingsLayout
});

function ConsoleSettingsLayout() {
  return (
    <div className="flex flex-col gap-0 lg:flex-row">
      <ConsoleSettingsNav />
      <div className="min-w-0 flex-1 lg:pl-8">
        <Outlet />
      </div>
    </div>
  );
}
