import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Cpu, Sparkles, Users, Zap } from 'lucide-react';

import { pageTitle } from '@/lib/head';
import { overviewQueries } from '@/server/functions/overview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConsoleCardsSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/')({
  // The counts, taken by the database and carried by one call — through
  // the cache, like every other page, so a return draws what was held and
  // reads again behind it.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(overviewQueries.console()),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Console') }] }),
  pendingComponent: () => <ConsoleCardsSkeleton />,
  component: ConsoleHome
});

function ConsoleHome() {
  const { data } = useQuery(overviewQueries.console());
  // Primed by the loader; a placeholder only for the cache being emptied.
  if (!data) return <ConsoleCardsSkeleton />;
  const { hasDefaultQuota, providers, models, prompts, users } = data;

  return (
    <div className="space-y-6">
      {!hasDefaultQuota && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            No default quota is set. Anyone without a quota of their own, or a
            plan that has one, cannot use the app. Create one under{' '}
            <Link to="/console/quotas" className="font-medium underline">
              Quotas
            </Link>{' '}
            and choose it as the default in{' '}
            <Link to="/console/settings" className="font-medium underline">
              Settings
            </Link>
            .
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link to="/console/providers">
          <Card className="transition-colors hover:bg-accent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Providers</CardTitle>
              <Zap className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{providers.total}</div>
              <p className="text-xs text-muted-foreground">
                {providers.enabled} enabled
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/console/models">
          <Card className="transition-colors hover:bg-accent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Models</CardTitle>
              <Cpu className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{models.total}</div>
              <p className="text-xs text-muted-foreground">
                {models.enabled} enabled
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/console/prompts">
          <Card className="transition-colors hover:bg-accent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Prompts</CardTitle>
              <Sparkles className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{prompts.total}</div>
              <p className="text-xs text-muted-foreground">
                {prompts.public} public / {prompts.private} private
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/console/users">
          <Card className="transition-colors hover:bg-accent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Users</CardTitle>
              <Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{users.total}</div>
              <p className="text-xs text-muted-foreground">
                {users.admins} admins
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
