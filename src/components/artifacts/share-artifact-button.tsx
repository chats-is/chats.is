import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Code, Link, LoaderCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { libraryQueries } from '@/server/functions/library';
import { createArtifactShare, shareQueries } from '@/server/functions/share';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * Shares one artifact on its own and copies its link, as a chat's Share does
 * for the chat — or the code that embeds it in another site, by the same
 * link. Sharing it again hands back the same link. Once shared, it says
 * so. The link is taken back from Shared Links, in Settings, and its embeds
 * go with it.
 */
export function ShareArtifactButton({
  artifactId,
  disabled,
  className
}: {
  artifactId: string;
  disabled?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { copyToClipboard } = useCopyToClipboard();
  const { data: share } = useQuery(shareQueries.artifact({ artifactId }));
  const shareMutation = useMutation({
    mutationFn: mutating(createArtifactShare)
  });

  // Shared already, its link is known; otherwise it is shared now, and
  // everything that shows whether it is learns so.
  const shared = async () => {
    if (share) return share;
    const created = await shareMutation.mutateAsync({ artifactId });
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

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={className}
              disabled={disabled || shareMutation.isPending}
            >
              {shareMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Share2 className="size-4" />
              )}
              <span className="sr-only">{share ? 'Shared' : 'Share'}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{share ? 'Shared' : 'Share'}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void copyShared('link')}>
          <Link className="size-4" />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyShared('embed')}>
          <Code className="size-4" />
          Copy embed code
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
