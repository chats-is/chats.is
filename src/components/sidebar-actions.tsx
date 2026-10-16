import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { mutating } from '@/lib/mutation';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { chatQueries } from '@/server/functions/chat';
import { createShare, shareQueries } from '@/server/functions/share';
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
  const queryClient = useQueryClient();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const [titleDialogOpen, setTitleDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const shareMutation = useMutation({
    mutationFn: mutating(createShare)
  });

  const copyShareLink = async (chatId: string) => {
    if (isCopied || shareMutation.isPending) return;

    try {
      // Shared already, its link is known; otherwise it is shared now, and
      // the list learns so.
      let shareId = chat.shareId;
      if (!shareId) {
        shareId = (await shareMutation.mutateAsync({ chatId })).id;
        void queryClient.invalidateQueries({
          queryKey: chatQueries.key.infinite()
        });
        void queryClient.invalidateQueries({ queryKey: shareQueries.all() });
      }

      const sharedLink = new URL(window.location.origin);
      sharedLink.pathname = `/share/${shareId}`;
      await copyToClipboard(sharedLink.toString());
      toast.success('Share link copied to clipboard', { duration: 2000 });
    } catch (error: any) {
      toast.error(error.message || 'Failed to share');
    }
  };

  return (
    <>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
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
        </DropdownMenuTrigger>
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
            ) : chat.shareId ? (
              <>
                <Share2 /> Copy link
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
