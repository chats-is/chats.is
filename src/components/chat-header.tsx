import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { PlusCircle } from 'lucide-react';

import { formatTitle } from '@/lib/head';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface ChatHeaderProps {
  title?: string;
}

export function ChatHeader({ title }: ChatHeaderProps) {
  const { appName } = useSystemSettings();
  const router = useRouter();

  const handleNewChat = () => {
    router.navigate({ to: '/' });
    router.invalidate();
  };

  useEffect(() => {
    // Only a page that names itself. A new chat has no title yet, and writing
    // one here would overwrite what the route already put in the head with
    // something shorter.
    if (!title) return;

    // Built the same way the route's head builds it, so this rewrites the title
    // only when a chat gains one mid-stream — never on arrival.
    const documentTitle = formatTitle(title, appName);

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
