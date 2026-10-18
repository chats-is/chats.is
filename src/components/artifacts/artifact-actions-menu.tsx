import { useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Code,
  Copy,
  CopyPlus,
  Download,
  Ellipsis,
  Link,
  LoaderCircle
} from 'lucide-react';
import { toast } from 'sonner';

import { type Artifact } from '@/types';
import { mutating } from '@/lib/mutation';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { duplicateArtifact } from '@/server/functions/artifact';
import { sessionQueries } from '@/server/functions/auth';
import { chatQueries } from '@/server/functions/chat';
import { libraryQueries } from '@/server/functions/library';
import { createArtifactShare, shareQueries } from '@/server/functions/share';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * What can be done with an artifact, each said in words: duplicate it into
 * a new chat, copy its content, download it, and — in its own chat — share
 * it, by its link or as code that embeds it in another site.
 *
 * Words are what make a press safe to act on at once: it is duplicated
 * without asking, with a note meanwhile, and the new chat opens when it is.
 * Whoever is not signed in signs in first, and comes back here. Sharing again
 * hands back the same link; once shared, its item says so. The link is taken
 * back from Shared Links, in Settings, and its embeds go with it.
 */
export function ArtifactActionsMenu({
  artifact,
  disabled,
  onDownload,
  canShare,
  canDuplicate = true,
  className
}: {
  artifact: Artifact;
  disabled?: boolean;
  /** Downloads it; absent when there is nothing to download. */
  onDownload?: () => void;
  /** Offers to share it on its own: in its chat, between turns. */
  canShare?: boolean;
  /** False while it may still be changing: in its chat, during a turn. */
  canDuplicate?: boolean;
  className?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { copyToClipboard } = useCopyToClipboard();
  const { data: user } = useQuery(sessionQueries.me());
  const { data: share } = useQuery({
    ...shareQueries.artifact({ artifactId: artifact.id }),
    enabled: !!canShare
  });
  const shareMutation = useMutation({
    mutationFn: mutating(createArtifactShare)
  });
  const [duplicating, setDuplicating] = useState(false);
  const content = artifact.content ?? '';

  const duplicate = async () => {
    if (!user) {
      void navigate({ to: '/login', search: { redirect: location.href } });
      return;
    }
    setDuplicating(true);
    const note = toast.loading('Duplicating…');
    try {
      const made = await duplicateArtifact({
        data: { artifactId: artifact.id }
      });
      void queryClient.invalidateQueries({
        queryKey: chatQueries.key.infinite()
      });
      await navigate({
        to: '/chat/$chatId',
        params: { chatId: made.chatId },
        search: { artifact: made.artifactId }
      });
      toast.dismiss(note);
    } catch (error: any) {
      toast.error(
        `Couldn’t duplicate. ${error?.message || 'Something went wrong.'}`,
        { id: note }
      );
    } finally {
      setDuplicating(false);
    }
  };

  // Shared already, its link is known; otherwise it is shared now, and
  // everything that shows whether it is learns so.
  const shared = async () => {
    if (share) return share;
    const created = await shareMutation.mutateAsync({
      artifactId: artifact.id
    });
    void queryClient.invalidateQueries({ queryKey: shareQueries.all() });
    void queryClient.invalidateQueries({ queryKey: libraryQueries.key.list() });
    return created;
  };

  const copyShared = async (as: 'link' | 'embed') => {
    try {
      const result = await shared();
      const link = new URL(window.location.origin);
      if (as === 'link') {
        link.pathname = `/artifact/${result.id}`;
        await copyToClipboard(link.toString());
        toast.success('Share link copied to clipboard', { duration: 2000 });
      } else {
        link.pathname = `/embed/${result.id}`;
        await copyToClipboard(
          `<iframe src="${link}" width="100%" height="600" style="border: 0" loading="lazy"></iframe>`
        );
        toast.success('Embed code copied to clipboard', { duration: 2000 });
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to share');
    }
  };

  const busy = duplicating || shareMutation.isPending;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={className}
              disabled={disabled || busy}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Ellipsis className="size-4" />
              )}
              <span className="sr-only">More actions</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!canDuplicate}
          onSelect={() => void duplicate()}
        >
          <CopyPlus className="size-4" />
          Duplicate
        </DropdownMenuItem>
        {content.trim() && (
          <DropdownMenuItem
            onSelect={async () => {
              await copyToClipboard(content);
              toast.success('Copied');
            }}
          >
            <Copy className="size-4" />
            Copy
          </DropdownMenuItem>
        )}
        {onDownload && (
          <DropdownMenuItem onSelect={onDownload}>
            <Download className="size-4" />
            Download
          </DropdownMenuItem>
        )}
        {canShare && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void copyShared('link')}>
              <Link className="size-4" />
              {share ? 'Copy link' : 'Share and copy link'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyShared('embed')}>
              <Code className="size-4" />
              Copy embed code
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
