import * as React from 'react';
import { api } from '@/trpc/react';
import {
  CheckCircle,
  Loader2,
  MoreVertical,
  Pencil,
  Share2,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

import { type Chat } from '@/types';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { SidebarMenuAction } from '@/components/ui/sidebar';
import { ChatDeleteDialog } from '@/components/chat-delete-dialog';
import { ChatRenameDialog } from '@/components/chat-rename-dialog';

interface SidebarActionsProps {
  chat: Chat;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

export function SidebarActions({
  chat,
  className,
  onOpenChange
}: SidebarActionsProps) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const [titleDialogOpen, setTitleDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const shareMutation = api.share.create.useMutation();

  const copyShareLink = async (chatId: string) => {
    if (isCopied || shareMutation.isPending) return;

    try {
      const result = await shareMutation.mutateAsync({ chatId });

      const sharedLink = new URL(window.location.origin);
      sharedLink.pathname = `/share/${result?.id}`;
      await copyToClipboard(sharedLink.toString());
      toast.success('Share link copied to clipboard', { duration: 2000 });
    } catch (error: any) {
      toast.error(error.message || 'Failed to share');
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              className={cn(
                'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100',
                className
              )}
            >
              <MoreVertical />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          }
        />
        <DropdownMenuContent sideOffset={8} align="start">
          <DropdownMenuItem
            className="flex items-center gap-2"
            onClick={() => copyShareLink(chat.id)}
            disabled={isCopied || shareMutation.isPending}
          >
            {isCopied ? (
              <>
                <CheckCircle /> Copied
              </>
            ) : shareMutation.isPending ? (
              <>
                <Loader2 className="animate-spin" /> Sharing...
              </>
            ) : (
              <>
                <Share2 /> Share
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center gap-2"
            onClick={() => setTitleDialogOpen(true)}
          >
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center gap-2"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChatDeleteDialog
        chat={chat}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
      />
      <ChatRenameDialog
        chat={chat}
        open={titleDialogOpen}
        onOpenChange={setTitleDialogOpen}
      />
    </>
  );
}
