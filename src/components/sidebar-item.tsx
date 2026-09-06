import * as React from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Image, MessageSquare, Mic, Video } from 'lucide-react';

import { type Chat } from '@/types';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

import { SidebarActions } from './sidebar-actions';

// Get icon for chat type
function ChatTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'image':
      return <Image className="size-4" />;
    case 'video':
      return <Video className="size-4" />;
    case 'audio':
      return <Mic className="size-4" />;
    default:
      return <MessageSquare className="size-4" />;
  }
}

interface SidebarItemProps {
  chat: Chat;
}

export function SidebarItem({ chat }: SidebarItemProps) {
  const params = useParams({ strict: false });
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <SidebarMenuItem>
      {/* All chats open in the unified chat view — legacy media chats
          (type image/video/audio) render their file parts there too. */}
      <SidebarMenuButton
        isActive={chat.id === params.chatId || isOpen}
        tooltip={chat.title}
        className="group-hover/menu-item:bg-background group-hover/menu-item:shadow-sm hover:bg-background hover:shadow-sm data-[active=true]:bg-background data-[active=true]:shadow-sm dark:group-hover/menu-item:bg-accent dark:hover:bg-accent dark:data-[active=true]:bg-accent"
        asChild
      >
        <Link to="/chat/$chatId" params={{ chatId: chat.id }}>
          <ChatTypeIcon type={chat.type} />
          <span className="truncate">{chat.title}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarActions chat={chat} onOpenChange={setIsOpen} />
    </SidebarMenuItem>
  );
}
