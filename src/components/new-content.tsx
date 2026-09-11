import { Link, useLocation } from '@tanstack/react-router';

import { contentTypes } from '@/lib/content-types';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar';

export function NewContent() {
  const pathname = useLocation({ select: l => l.pathname });

  const isActive = (path: string) => {
    // Only match root path, not paths with IDs
    return pathname === path;
  };

  return (
    <SidebarGroup className="mt-2">
      <SidebarGroupContent>
        <SidebarMenu>
          {contentTypes.map(({ type, label, icon: Icon, path }) => {
            const active = isActive(path);
            return (
              <SidebarMenuItem key={type}>
                {/* A link, so it behaves like one: an address to copy, a
                    middle click that opens a tab, and the preloading that
                    starts when the pointer lands on it. */}
                <SidebarMenuButton
                  isActive={active}
                  tooltip={label}
                  className="hover:bg-background hover:shadow-sm data-[active=true]:bg-background data-[active=true]:shadow-sm dark:hover:bg-accent dark:data-[active=true]:bg-accent"
                  asChild
                >
                  <Link to={path}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
