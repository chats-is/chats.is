import * as React from 'react';
import { type UseChatHelpers } from '@ai-sdk/react';
import { useMutation } from '@tanstack/react-query';
import {
  CheckCircle,
  Copy,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

import { type ChatMessage } from '@/types';
import { mutating } from '@/lib/mutation';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { deleteMessages, updateMessage } from '@/server/functions/message';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ReadAloudButton } from '@/components/read-aloud-button';

interface MessageActionsProps extends Partial<
  Pick<UseChatHelpers<ChatMessage>, 'status' | 'setMessages'>
> {
  modelId: string;
  message: ChatMessage;
  reload?: (message: ChatMessage) => void;
  isReadonly?: boolean;
  isLastMessage?: boolean;
}

export function MessageActions({
  modelId,
  status,
  reload,
  message,
  setMessages,
  isReadonly,
  isLastMessage
}: MessageActionsProps) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const [draftContent, setDraftContent] = React.useState('');
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const updateMutation = useMutation({
    mutationFn: mutating(updateMessage)
  });
  const deleteMutation = useMutation({
    mutationFn: mutating(deleteMessages)
  });

  const textParts = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
    .trim();

  // Check if message contains file content (image, audio, video)
  const hasFileContent = message.parts?.some(
    part =>
      part.type === 'file' &&
      (part.mediaType.startsWith('image/') ||
        part.mediaType.startsWith('audio/') ||
        part.mediaType.startsWith('video/'))
  );

  React.useEffect(() => {
    setDraftContent(textParts);
  }, [textParts]);

  const onCopy = async () => {
    if (isCopied) return;

    // If message contains file, copy file URL
    if (hasFileContent) {
      const filePart = message.parts?.find(
        part =>
          part.type === 'file' &&
          (part.mediaType.startsWith('image/') ||
            part.mediaType.startsWith('audio/') ||
            part.mediaType.startsWith('video/'))
      );

      if (filePart && filePart.type === 'file') {
        await copyToClipboard(filePart.url);
        return;
      }
    }

    // Otherwise copy text
    if (!textParts) {
      toast.error("There's no text to copy!");
      return;
    }

    await copyToClipboard(textParts);
  };

  const onDownload = async () => {
    if (!hasFileContent) return;

    const filePart = message.parts?.find(
      part =>
        part.type === 'file' &&
        (part.mediaType.startsWith('image/') ||
          part.mediaType.startsWith('audio/') ||
          part.mediaType.startsWith('video/'))
    );

    if (filePart && filePart.type === 'file') {
      try {
        // Get file extension
        const extension = filePart.mediaType.split('/')[1];
        const fileName = `${message.id}.${extension}`;

        // Create temporary link and trigger download
        const link = document.createElement('a');
        link.href = filePart.url;
        link.download = fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success('Download started');
      } catch {
        toast.error('Failed to download file');
      }
    }
  };

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-1 lg:group-focus-within:visible lg:group-hover:visible',
        message.role === 'user' && 'justify-end',
        // Indented past the avatar so the row sits under the text. A shared
        // chat has no avatars, so there is only the text's own padding to match.
        isReadonly ? 'mx-1' : message.role === 'user' ? 'mr-12' : 'ml-12',
        isLastMessage ? 'lg:visible' : 'lg:invisible'
      )}
    >
      {/* Not on a shared chat. Reading aloud is a generation — it calls a
          priced model and is charged to whoever asked — and a shared chat is
          read by people with no account to charge. */}
      {!isReadonly && !hasFileContent && textParts && (
        <ReadAloudButton text={textParts} />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        onClick={onCopy}
        disabled={isCopied}
      >
        {isCopied ? (
          <CheckCircle className="size-4" />
        ) : (
          <Copy className="size-4" />
        )}
        <span className="sr-only">Copy</span>
      </Button>
      {hasFileContent && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={onDownload}
        >
          <Download className="size-4" />
          <span className="sr-only">Download</span>
        </Button>
      )}
      {!isReadonly && setMessages && reload && (
        <>
          {isLastMessage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  onClick={() => reload(message)}
                  disabled={status !== 'ready' && status !== 'error'}
                >
                  <RefreshCw className="size-4" />
                  <span className="sr-only">Retry</span>
                </Button>
              </TooltipTrigger>
              {/* The model name used to expand inline on hover, which resized
                  the button and shifted the row next to it. A tooltip keeps the
                  action bar's geometry fixed. */}
              <TooltipContent>Retry with {modelId}</TooltipContent>
            </Tooltip>
          )}
          {!hasFileContent && message.role === 'user' && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                disabled={
                  status === 'submitted' ||
                  status === 'streaming' ||
                  updateMutation.isPending
                }
                onClick={() => setEditDialogOpen(true)}
              >
                <Pencil className="size-4" />
                <span className="sr-only">Edit</span>
              </Button>
              <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit message</DialogTitle>
                    <DialogDescription>
                      Edit chat message content.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
                    <Textarea
                      className="min-h-32"
                      defaultValue={draftContent}
                      onChange={e => setDraftContent(e.target.value)}
                      required
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={
                        updateMutation.isPending || textParts === draftContent
                      }
                      onClick={async () => {
                        if (draftContent) {
                          const updated = {
                            ...message,
                            // Editing is only offered on the user's own
                            // messages; said here so the type agrees.
                            role: 'user' as const,
                            content: draftContent,
                            parts: message.parts.map(part =>
                              part.type === 'text'
                                ? {
                                    type: 'text' as const,
                                    text: draftContent
                                  }
                                : part
                            )
                          };

                          try {
                            await updateMutation.mutateAsync({
                              id: message.id,
                              message: updated
                            });
                            toast.success('Message saved', { duration: 2000 });

                            setMessages((messages: ChatMessage[]) => {
                              return messages.map((m: ChatMessage) =>
                                m.id === message.id ? updated : m
                              );
                            });
                            setEditDialogOpen(false);

                            if (message.role === 'user') {
                              reload(updated);
                            }
                          } catch (error: any) {
                            toast.error(
                              error.message || 'Failed to save message'
                            );
                          }
                        }
                      }}
                    >
                      {updateMutation.isPending ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>Save</>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            disabled={
              status === 'submitted' ||
              status === 'streaming' ||
              deleteMutation.isPending
            }
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="size-4" />
            <span className="sr-only">Delete</span>
          </Button>
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete your{' '}
                  {message.role === 'user'
                    ? 'message and its assistant’s message'
                    : 'message'}
                  , remove your data from our servers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteMutation.isPending}
                  onClick={async e => {
                    e.preventDefault();
                    try {
                      await deleteMutation.mutateAsync({ id: message.id });
                      toast.success('Message deleted', { duration: 2000 });
                      setMessages((messages: ChatMessage[]) => {
                        // If deleting user message, also delete all AI messages with it as parentId
                        if (message.role === 'user') {
                          return messages.filter(
                            (m: ChatMessage) =>
                              m.id !== message.id &&
                              m.metadata?.parentId !== message.id
                          );
                        }

                        // If deleting AI message, only delete itself
                        return messages.filter(
                          (m: ChatMessage) => m.id !== message.id
                        );
                      });
                      setDeleteDialogOpen(false);
                    } catch (error: any) {
                      toast.error(error.message || 'Failed to delete message');
                    }
                  }}
                >
                  {deleteMutation.isPending ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>Delete</>
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
