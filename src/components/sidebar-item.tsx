import * as React from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';

import { type Chat } from '@/types';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

import { SidebarActions } from './sidebar-actions';

interface SidebarItemProps {
  chat: Chat;
}

export function SidebarItem({ chat }: SidebarItemProps) {
  const params = useParams({ strict: false });
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={chat.id === params.chatId || isOpen}
        tooltip={chat.title}
        className="group-hover/menu-item:bg-background group-hover/menu-item:shadow-sm hover:bg-background hover:shadow-sm data-[active=true]:bg-background data-[active=true]:shadow-sm dark:group-hover/menu-item:bg-accent dark:hover:bg-accent dark:data-[active=true]:bg-accent"
        asChild
      >
        <Link to="/chat/$chatId" params={{ chatId: chat.id }}>
          <MessageSquare className="size-4" />
          <span className="truncate">{chat.title}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarActions chat={chat} onOpenChange={setIsOpen} />
    </SidebarMenuItem>
  );
}
