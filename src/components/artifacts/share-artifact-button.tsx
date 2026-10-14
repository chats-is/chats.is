import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { createArtifactShare, shareQueries } from '@/server/functions/share';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * Shares one artifact on its own and copies its link, as a chat's Share does
 * for the chat: sharing it again hands back the same link. The link is taken
 * back from Shared Links, in Settings.
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
  const shareMutation = useMutation({
    mutationFn: mutating(createArtifactShare),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: shareQueries.key.list()
      });
    }
  });

  const copyShareLink = async () => {
    try {
      const result = await shareMutation.mutateAsync({ artifactId });
      const link = new URL(window.location.origin);
      link.pathname = `/artifact/${result?.id}`;
      await copyToClipboard(link.toString());
      toast.success('Share link copied to clipboard', { duration: 2000 });
    } catch (error: any) {
      toast.error(error.message || 'Failed to share');
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          disabled={disabled || shareMutation.isPending}
          onClick={copyShareLink}
        >
          {shareMutation.isPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Share2 className="size-4" />
          )}
          <span className="sr-only">Share</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Share</TooltipContent>
    </Tooltip>
  );
}
