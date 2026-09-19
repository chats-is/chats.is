import {
  createFileRoute,
  Link,
  Outlet,
  useLocation
} from '@tanstack/react-router';

import { settingsQueries } from '@/server/functions/settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DefaultsPending,
  GeneralPending
} from '@/components/console/settings/pending';

export const Route = createFileRoute('/console/settings')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(settingsQueries.list()),
  pendingComponent: SettingsPending,
  component: ConsoleSettingsLayout
});

const SECTIONS = [
  { id: 'general', label: 'General', to: '/console/settings/general' },
  { id: 'defaults', label: 'Defaults', to: '/console/settings/defaults' }
] as const;

type Section = (typeof SECTIONS)[number]['id'];

/**
 * Which section the address names. `/console/settings` itself redirects, so
 * the fallback only covers the instant before that lands.
 */
function useSection(): Section {
  const pathname = useLocation({ select: location => location.pathname });
  const last = pathname.split('/').filter(Boolean).pop();

  return SECTIONS.some(section => section.id === last)
    ? (last as Section)
    : 'general';
}

/**
 * The tabs are links, not a control with a state of its own.
 *
 * A section is a route, so it can be linked to, opened in a new tab and come
 * back to — `Tabs` is told which one the address names and is never asked to
 * decide. Navigating is what changes it.
 */
function SettingsShell({ children }: { children: React.ReactNode }) {
  const section = useSection();

  return (
    <Tabs value={section} className="gap-6">
      {/* The bar runs the width of the page — it is the page's own header, not
          a control sitting in it — while the tabs themselves stay at the left,
          where the eye starts. `flex-none` is what stops them sharing the width
          out between them. */}
      <TabsList className="w-full justify-start">
        {SECTIONS.map(item => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className="flex-none px-4"
            asChild
          >
            <Link to={item.to}>{item.label}</Link>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* One panel, always the open one: which section is showing is the
          address's answer, not this component's, so there is nothing for a
          second panel to hold. */}
      <TabsContent value={section}>{children}</TabsContent>
    </Tabs>
  );
}

/**
 * The tabs are a static list, so they are the real ones either side of the
 * wait — only the panel under them stands in, and which page it stands in for
 * is something the address already answers.
 */
function SettingsPending() {
  const section = useSection();

  return (
    <SettingsShell>
      {section === 'defaults' ? <DefaultsPending /> : <GeneralPending />}
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
