import { Link } from '@tanstack/react-router';
import {
  ChevronsUpDown,
  ExternalLink,
  Github,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield
} from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { useCurrentUser } from '@/hooks/use-current-user';
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
import { useOpenSettings } from '@/components/settings-dialog';

export function UserMenu() {
  const { user, isLoading } = useCurrentUser();
  const { isMobile, state } = useSidebar();
  const isCollapsed = state === 'collapsed';
  const openSettings = useOpenSettings();

  if (isLoading) {
    return (
      <SidebarMenu className="my-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-1 text-left text-sm leading-tight">
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
              className="group-data-[state=expanded]:border group-data-[state=expanded]:bg-background group-data-[state=expanded]:shadow-sm hover:bg-accent data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-full border">
                <AvatarImage src={user.image || ''} alt={user.name || ''} />
                <AvatarFallback className="rounded-full">
                  {user.name
                    ? user.name.slice(0, 2).toUpperCase()
                    : (user.email?.[0] || '?').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
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
                onClick={openSettings}
                className="flex items-center gap-2"
              >
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
            )}
            {user.admin && (
              <DropdownMenuItem asChild>
                <Link to="/console" className="flex w-full items-center gap-2">
                  <LayoutDashboard className="size-4" />
                  Console
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
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
                  <Github className="size-4" />
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
