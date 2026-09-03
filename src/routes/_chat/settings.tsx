import { createFileRoute, Outlet } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { SettingsNav } from '@/components/settings-nav';

export const Route = createFileRoute('/_chat/settings')({
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Settings') }] }),
  component: SettingsLayout
});

function SettingsLayout() {
  return (
    <div className="flex size-full flex-col overflow-hidden">
      <header className="relative flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1 md:hidden" />
        <div className="pointer-events-none absolute inset-x-14 flex items-center justify-center px-1 font-semibold md:inset-x-4">
          <span className="truncate">Settings</span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex flex-col gap-0 lg:flex-row">
          <SettingsNav />
          <div className="min-w-0 flex-1 pr-4 pl-8 md:pr-6 md:pl-12">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
