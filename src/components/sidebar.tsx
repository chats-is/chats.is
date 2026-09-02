import * as React from 'react';
import { Link } from '@tanstack/react-router';
import { useSystemSettings } from '@/contexts/system-settings-context';

import { Separator } from '@/components/ui/separator';
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarPrimitive,
  SidebarRail,
  SidebarTrigger
} from '@/components/ui/sidebar';
import { NewContent } from '@/components/new-content';
import { SidebarList } from '@/components/sidebar-list';
import { UserMenu } from '@/components/user-menu';

export function Sidebar({
  ...props
}: React.ComponentProps<typeof SidebarPrimitive>) {
  const { appName } = useSystemSettings();

  return (
    <SidebarPrimitive collapsible="icon" {...props}>
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem className="relative">
            <SidebarMenuButton
              size="lg"
              className="gap-1 p-0 transition-opacity duration-150 ease-out group-data-[collapsible=icon]:group-hover/menu-item:opacity-0 hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground motion-reduce:transition-none"

              render={
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center">
                    <img src="/favicon.svg" alt="Logo" className="size-7" />
                  </div>
                  <div className="grid flex-1 text-left text-lg font-medium group-data-[collapsible=icon]:hidden">
                    <span className="truncate">{appName}</span>
                  </div>
                </Link>
              }
            />
            <SidebarTrigger className="pointer-events-auto absolute top-1/2 right-0 z-10 hidden size-8 -translate-y-1/2 opacity-100 transition-opacity duration-150 ease-out group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:group-hover/menu-item:pointer-events-auto group-data-[collapsible=icon]:group-hover/menu-item:opacity-100 motion-reduce:transition-none md:flex" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NewContent />
        <div className="px-2">
          <Separator className="bg-sidebar-border" />
        </div>
        <SidebarList />
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </SidebarPrimitive>
  );
}
