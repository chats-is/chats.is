import { Metadata } from 'next';
import Link from 'next/link';
import { Cpu, Settings, Sparkles, Users, Zap } from 'lucide-react';

import { api } from '@/trpc/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Console'
};

export default async function ConsolePage() {
  const [providers, models, promptStats, settings, userStats] =
    await Promise.all([
      api.provider.list(),
      api.model.list(),
      api.prompt.adminStats(),
      api.settings.list(),
      api.user.getStats()
    ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/console/providers">
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

        <Link href="/console/models">
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

        <Link href="/console/prompts">
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

        <Link href="/console/settings">
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

        <Link href="/console/users">
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
