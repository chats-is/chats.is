import { createFileRoute, Link } from '@tanstack/react-router';
import { Cpu, Settings, Sparkles, Users, Zap } from 'lucide-react';

import { pageTitle } from '@/lib/head';
import { listModels } from '@/server/fn/model';
import { getPromptStats } from '@/server/fn/prompt';
import { listProviders } from '@/server/fn/provider';
import { listSettings } from '@/server/fn/settings';
import { getUserStats } from '@/server/fn/user';
import { RoutePending } from '@/components/route-pending';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const Route = createFileRoute('/console/')({
  loader: async () => {
    const [providers, models, promptStats, settings, userStats] =
      await Promise.all([
        listProviders(),
        listModels({ data: {} }),
        getPromptStats(),
        listSettings(),
        getUserStats()
      ]);

    return { providers, models, promptStats, settings, userStats };
  },
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Console') }] }),
  pendingComponent: RoutePending,
  component: ConsoleHome
});

function ConsoleHome() {
  const { providers, models, promptStats, settings, userStats } =
    Route.useLoaderData();

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
              <div className="text-2xl font-bold">{providers.length}</div>
              <p className="text-xs text-muted-foreground">
                {providers.filter(p => p.isEnabled).length} enabled
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
              <div className="text-2xl font-bold">{models.length}</div>
              <p className="text-xs text-muted-foreground">
                {models.filter(m => m.isEnabled).length} enabled
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
              <div className="text-2xl font-bold">{promptStats.total}</div>
              <p className="text-xs text-muted-foreground">
                {promptStats.public} public / {promptStats.private} private
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
              <div className="text-2xl font-bold">{settings.length}</div>
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
              <div className="text-2xl font-bold">{userStats.total}</div>
              <p className="text-xs text-muted-foreground">
                {userStats.admins} admins
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
