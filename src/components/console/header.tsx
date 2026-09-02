import { useLocation } from '@tanstack/react-router';

import { ConsoleNavigation } from '@/lib/console-navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';

export function ConsoleHeader() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const currentItem = ConsoleNavigation.navMain.find(item =>
    item.url === '/console'
      ? pathname === item.url
      : pathname.startsWith(item.url)
  );
  const fallbackTitle = pathname
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/-/g, ' ');
  const title =
    currentItem?.title ||
    (fallbackTitle
      ? fallbackTitle.charAt(0).toUpperCase() + fallbackTitle.slice(1)
      : '');

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1 md:hidden" />
      <div className="pointer-events-none absolute inset-x-14 flex items-center justify-center px-1 font-semibold md:inset-x-4">
        <span className="truncate">{title}</span>
      </div>
    </header>
  );
}
