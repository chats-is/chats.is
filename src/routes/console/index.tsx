import { createFileRoute, Link } from '@tanstack/react-router';
import { Cpu, Settings, Sparkles, Users, Zap } from 'lucide-react';

import { pageTitle } from '@/lib/head';
import { getConsoleOverview } from '@/server/fn/overview';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConsoleCardsSkeleton } from '@/components/console/skeletons';

export const Route = createFileRoute('/console/')({
  // Nine counts, counted by the database and carried by one call.
  loader: () => getConsoleOverview(),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Console') }] }),
  pendingComponent: () => <ConsoleCardsSkeleton />,
  component: ConsoleHome
});

function ConsoleHome() {
  const { providers, models, prompts, settings, users } = Route.useLoaderData();

  return (
    <div className="space-y-6">
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

        <Link to="/console/settings">
          <Card className="transition-colors hover:bg-accent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Settings</CardTitle>
              <Settings className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{settings.total}</div>
              <p className="text-xs text-muted-foreground">
                System configuration
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
