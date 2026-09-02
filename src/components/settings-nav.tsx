import { Link, useLocation } from '@tanstack/react-router';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { BarChart3, Link2, Settings, Sparkles, Volume2 } from 'lucide-react';

import { cn } from '@/lib/utils';

const SETTINGS_NAV_ITEMS = [
  {
    href: '/settings/general',
    icon: Settings,
    label: 'General',
    value: 'general'
  },
  {
    href: '/settings/speech',
    icon: Volume2,
    label: 'Speech',
    value: 'speech'
  },
  {
    href: '/settings/usage',
    icon: BarChart3,
    label: 'Usage',
    value: 'usage'
  },
  {
    href: '/settings/shared-links',
    icon: Link2,
    label: 'Shared Links',
    value: 'shared-links'
  },
  {
    href: '/settings/prompts',
    icon: Sparkles,
    label: 'Prompts',
    value: 'prompts'
  }
] as const;

const linkClassName = (active: boolean) =>
  cn(
    'inline-flex h-9 w-full items-center justify-start gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground/60 transition-colors hover:bg-muted hover:text-foreground',
    active && 'bg-muted text-foreground'
  );

export function SettingsNav() {
  const pathname = useLocation({ select: l => l.pathname });
  const { ttsModels, speechEnabled } = useSystemSettings();
  const isSpeechAvailable = (ttsModels?.length ?? 0) > 0 && speechEnabled;

  return (
    <nav className="flex w-full shrink-0 flex-col gap-1 lg:sticky lg:top-0 lg:w-52">
      {SETTINGS_NAV_ITEMS.filter(
        item => item.value !== 'speech' || isSpeechAvailable
      ).map(item => {
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
