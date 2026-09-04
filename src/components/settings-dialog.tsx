import { createContext, useCallback, useContext, useState } from 'react';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { BarChart3, Link2, Settings, Sparkles, Volume2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { SettingsGeneral } from '@/components/settings-general';
import { SettingsProfile } from '@/components/settings-profile';
import { SettingsSpeech } from '@/components/settings-speech';
import { SettingsUsage } from '@/components/settings-usage';
import { SharedLinks } from '@/components/shared-links';
import { UserPrompt } from '@/components/user-prompt';

/**
 * The user's settings.
 *
 * These are adjustments to the app you are already using — a theme, a voice,
 * what you have shared — so they open over the page rather than replacing it,
 * and closing puts you back exactly where you were. The panel that is open is
 * not in the address: nobody links another person to their own settings, and
 * an address that survived a refresh would reopen a dialog over whatever the
 * refresh landed on.
 *
 * Each panel loads its own data and shows its own waiting state, so opening
 * the dialog fetches only the panel being looked at.
 */

const PANELS = [
  { value: 'general', label: 'General', icon: Settings },
  { value: 'speech', label: 'Speech', icon: Volume2 },
  { value: 'usage', label: 'Usage', icon: BarChart3 },
  { value: 'shared-links', label: 'Shared Links', icon: Link2 },
  { value: 'prompts', label: 'Prompts', icon: Sparkles }
] as const;

type Panel = (typeof PANELS)[number]['value'];

function PanelBody({ panel }: { panel: Panel }) {
  switch (panel) {
    case 'general':
      return (
        <section className="space-y-6">
          <SettingsProfile />
          <SettingsGeneral />
        </section>
      );
    case 'speech':
      return <SettingsSpeech />;
    case 'usage':
      return <SettingsUsage />;
    case 'shared-links':
      return <SharedLinks />;
    case 'prompts':
      return <UserPrompt />;
  }
}

function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { ttsModels, speechEnabled } = useSystemSettings();
  const isSpeechAvailable = (ttsModels?.length ?? 0) > 0 && speechEnabled;

  const panels = PANELS.filter(
    panel => panel.value !== 'speech' || isSpeechAvailable
  );

  const [panel, setPanel] = useState<Panel>('general');
  // Speech can disappear while the dialog is shut — an admin turning it off —
  // which would otherwise leave the dialog open on a tab that is no longer
  // offered.
  const current = panels.some(item => item.value === panel) ? panel : 'general';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(38rem,calc(100dvh-4rem))] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Your account, appearance, usage and shared links.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-48 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-3">
            {panels.map(item => {
              const Icon = item.icon;
              const isActive = item.value === current;

              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setPanel(item.value)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center justify-start gap-2 rounded-md px-2 py-2 text-sm font-medium text-foreground/60 transition-colors hover:bg-muted hover:text-foreground sm:w-full',
                    isActive && 'bg-muted text-foreground'
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Keyed by panel so a switch starts the new one at the top rather
              than inheriting the scroll position of the one before it. */}
          <div key={current} className="min-w-0 flex-1 overflow-y-auto p-5">
            <PanelBody panel={current} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const OpenSettings = createContext<(() => void) | null>(null);

/**
 * Holds the settings dialog, and hands out the way to open it.
 *
 * Mount it inside the providers the panels read — system settings and
 * preferences — because that is what decides where the dialog can work. The
 * menu that opens it lives in a sidebar that several layouts render, including
 * one still waiting for that data, so this is what tells the two apart.
 */
export function SettingsDialogProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openSettings = useCallback(() => setOpen(true), []);

  return (
    <OpenSettings.Provider value={openSettings}>
      {children}
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </OpenSettings.Provider>
  );
}

/**
 * How a menu opens the settings — or `null` where there is no dialog to open,
 * which is a shell whose data has not arrived. A caller that gets `null` should
 * leave the entry out rather than offer one that cannot work.
 */
export function useOpenSettings() {
  return useContext(OpenSettings);
}
