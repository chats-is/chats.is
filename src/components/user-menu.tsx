import { Link } from '@tanstack/react-router';
import { useSystemSettingsIfLoaded } from '@/contexts/system-settings-context';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronsUpDown,
  ExternalLink,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  Sparkles
} from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { useCurrentUser } from '@/hooks/use-current-user';
import { subscriptionQueries } from '@/server/functions/subscription';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { IconGitHub } from '@/components/icons';
import { useOpenPlans } from '@/components/plans-dialog';
import { useOpenSettings } from '@/components/settings-dialog';

export function UserMenu() {
  const { user, isLoading } = useCurrentUser();
  const { isMobile, state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const openSettings = useOpenSettings();
  const openPlans = useOpenPlans();
  const subscriptionsEnabled =
    useSystemSettingsIfLoaded()?.subscriptionsEnabled ?? false;
  // The plan the user is on, beside their name: that of their subscription,
  // which every change to it refreshes — Free without one. Shown once
  // known, so it does not flick from Free to the plan.
  const { data: subscription, isSuccess } = useQuery({
    ...subscriptionQueries.mine(),
    enabled: !!user
  });
  const planName = isSuccess ? (subscription?.planName ?? 'Free') : null;
  // On Free, the way up sits beside it, while plans are sold.
  const offerUpgrade =
    isSuccess && !subscription && subscriptionsEnabled && !!openPlans;

  if (isLoading) {
    return (
      <SidebarMenu className="my-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="group-data-[collapsible=icon]:justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Skeleton className="size-6 rounded-full" />
            <div className="grid flex-1 gap-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (!user) return null;

  return (
    <SidebarMenu className="my-1">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              // Collapsed, the button is the avatar's width and a little
              // more, with no padding: the avatar is centred in it, and the
              // name and the arrow, out of sight, take no room beside it.
              className="group-data-[collapsible=icon]:justify-center group-data-[state=expanded]:border group-data-[state=expanded]:bg-background group-data-[state=expanded]:shadow-sm hover:bg-accent data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-6 rounded-full">
                <AvatarImage src={user.image || ''} alt={user.name || ''} />
                <AvatarFallback className="rounded-full text-[10px]">
                  {user.name
                    ? user.name.slice(0, 2).toUpperCase()
                    : (user.email?.[0] || '?').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {/* The name and the plan on one line; the name gives way when
                  it is long, the plan never does. */}
              <div className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold">{user.name}</span>
                {planName && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {planName}
                  </span>
                )}
                {offerUpgrade && (
                  // Right after the plan. Inside the menu's button, which
                  // cannot hold another, so a pill that takes the press for
                  // itself; the menu's own "Upgrade plan" is the way for
                  // the keyboard.
                  <span
                    aria-hidden
                    onPointerDown={e => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      openPlans?.();
                    }}
                    className="shrink-0 cursor-pointer rounded-full border bg-background px-2 py-0.5 text-xs font-medium hover:bg-accent"
                  >
                    Upgrade
                  </span>
                )}
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : isCollapsed ? 'right' : 'top'}
            align="end"
            sideOffset={4}
          >
            {openSettings && (
              <DropdownMenuItem
                onClick={() => openSettings()}
                className="flex items-center gap-2"
              >
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
            )}
            {/* Once subscribed, upgrading is done from Billing. */}
            {offerUpgrade && (
              <DropdownMenuItem
                onClick={() => openPlans?.()}
                className="flex items-center gap-2"
              >
                <Sparkles className="size-4" />
                Upgrade plan
              </DropdownMenuItem>
            )}
            {user.admin && (
              <>
                {/* Its own band: the console is a different part of the app,
                    not another of this menu's own settings. The separator is
                    conditional so it cannot open the menu with a rule. */}
                {openSettings && <DropdownMenuSeparator />}
                <DropdownMenuItem asChild>
                  <Link
                    to="/console"
                    className="flex w-full items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <LayoutDashboard className="size-4" />
                      Console
                    </div>
                    <ExternalLink className="size-4" />
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                to="/terms"
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <FileText className="size-4" />
                  Terms of Service
                </div>
                <ExternalLink className="size-4" />
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to="/privacy"
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Shield className="size-4" />
                  Privacy Policy
                </div>
                <ExternalLink className="size-4" />
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href="https://github.com/chats-is/chats.is"
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <IconGitHub className="size-4" />
                  GitHub
                </div>
                <ExternalLink className="size-4" />
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                authClient.signOut().then(() => {
                  window.location.href = '/';
                })
              }
              className="flex items-center gap-2"
            >
              <LogOut className="size-4" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
