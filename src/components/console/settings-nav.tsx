import { Link, useLocation } from '@tanstack/react-router';
import { Boxes, Gauge, Settings, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

const CONSOLE_SETTINGS_NAV_ITEMS = [
  { href: '/console/settings/general', icon: Settings, label: 'General' },
  { href: '/console/settings/models', icon: Boxes, label: 'Models' },
  { href: '/console/settings/prompts', icon: Sparkles, label: 'Prompts' },
  { href: '/console/settings/quota', icon: Gauge, label: 'Quota' }
] as const;

const linkClassName = (active: boolean) =>
  cn(
    'inline-flex h-9 w-full items-center justify-start gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground/60 transition-colors hover:bg-muted hover:text-foreground',
    active && 'bg-muted text-foreground'
  );

export function ConsoleSettingsNav() {
  const pathname = useLocation({ select: l => l.pathname });

  return (
    <nav className="flex w-full shrink-0 flex-col gap-1 lg:sticky lg:top-0 lg:w-52">
      {CONSOLE_SETTINGS_NAV_ITEMS.map(item => {
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            to={item.href}
            className={linkClassName(pathname === item.href)}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
