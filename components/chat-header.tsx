'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { PlusCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface ChatHeaderProps {
  title?: string;
}

export function ChatHeader({ title }: ChatHeaderProps) {
  const { appName } = useSystemSettings();
  const router = useRouter();

  const handleNewChat = () => {
    router.push('/');
    router.refresh();
  };

  useEffect(() => {
    const documentTitle = title ? `${title} - ${appName}` : appName;

    if (documentTitle !== document.title) {
      document.title = documentTitle;
    }
  }, [title, appName]);

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1 md:hidden" />
      <div className="pointer-events-none absolute inset-x-14 flex items-center justify-center px-1 font-semibold md:inset-x-4">
        <span className="truncate">{title}</span>
      </div>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="-ml-1 size-7 md:hidden"
        onClick={handleNewChat}
      >
        <PlusCircle />
        <span className="sr-only">New chat</span>
      </Button>
    </header>
  );
}
