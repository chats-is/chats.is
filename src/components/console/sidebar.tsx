import * as React from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { CONSOLE_NAVIGATION } from '@/lib/constant';
import { subscriptionQueries } from '@/server/functions/subscription';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarPrimitive,
  SidebarRail,
  SidebarTrigger
} from '@/components/ui/sidebar';
import { refundRequestTableInput } from '@/components/console/table-filters';
import { UserMenu } from '@/components/user-menu';

export function Sidebar({
  ...props
}: React.ComponentProps<typeof SidebarPrimitive>) {
  const pathname = useLocation({ select: l => l.pathname });
  // Refund requests waiting on an admin, beside their page.
  const { data: requests } = useQuery(
    subscriptionQueries.refundRequests(refundRequestTableInput({}))
  );
  const pendingRequests = requests?.pendingApproval ?? 0;

  return (
    <SidebarPrimitive collapsible="icon" {...props}>
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem className="relative">
            <SidebarMenuButton
              size="lg"
              className="gap-1 p-0 transition-opacity duration-150 ease-out group-data-[collapsible=icon]:group-hover/menu-item:opacity-0 hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground motion-reduce:transition-none"
              asChild
            >
              <Link to="/console">
                <div className="flex aspect-square size-8 items-center justify-center">
                  <img src="/favicon.svg" alt="Logo" className="size-7" />
                </div>
                <div className="grid flex-1 text-left text-lg font-medium group-data-[collapsible=icon]:hidden">
                  <span className="truncate">Console</span>
                </div>
              </Link>
            </SidebarMenuButton>
            <SidebarTrigger className="pointer-events-auto absolute top-1/2 right-0 z-10 hidden size-8 -translate-y-1/2 opacity-100 transition-opacity duration-150 ease-out group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:group-hover/menu-item:pointer-events-auto group-data-[collapsible=icon]:group-hover/menu-item:opacity-100 motion-reduce:transition-none md:flex" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {/* Groups close together: their headings already set them apart. */}
      <SidebarContent className="gap-0 py-1">
        {CONSOLE_NAVIGATION.map(group => (
          <SidebarGroup key={group.title} className="py-1">
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(item => {
                  const isActive =
                    item.url === '/console'
                      ? pathname === '/console'
                      : pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.title}
                        className="hover:bg-background hover:shadow-sm data-[active=true]:bg-background data-[active=true]:shadow-sm dark:hover:bg-accent dark:data-[active=true]:bg-accent"
                        asChild
                      >
                        <Link to={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.url === '/console/refund-requests' &&
                        pendingRequests > 0 && (
                          <SidebarMenuBadge>{pendingRequests}</SidebarMenuBadge>
                        )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </SidebarPrimitive>
  );
}
