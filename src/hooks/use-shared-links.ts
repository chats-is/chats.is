import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mutating } from '@/lib/mutation';
import {
  deleteAllShares,
  deleteShare,
  shareQueries
} from '@/server/functions/share';

/** `page` is 1-based, as it is everywhere else the app pages. */
export function useSharedLinks(page: number = 1, pageSize?: number) {
  const queryClient = useQueryClient();

  const { data, error, isLoading, isPlaceholderData, refetch } = useQuery(
    shareQueries.list({ page, pageSize })
  );

  const deleteMutation = useMutation({
    mutationFn: mutating(deleteShare),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareQueries.key.list() });
    }
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => deleteAllShares(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareQueries.key.list() });
    }
  });

  const deleteSharedLink = async (id: string) => {
    await deleteMutation.mutateAsync({ id });
  };

  const deleteAllSharedLinks = async () => {
    await deleteAllMutation.mutateAsync();
  };

  // Transform data to match SharedLink[] format
  const sharedLinks = data?.rows.map(share => ({
    id: share.id,
    createdAt: share.createdAt,
    chat: share.chat
  }));

  return {
    sharedLinks,
    /** What the pager counts: links across every page, not just this one. */
    total: data?.total ?? 0,
    error,
    isLoading,
    /** Showing the previous page while the next one is fetched. */
    isPending: isPlaceholderData,
    isError: !!error,
    deleteSharedLink,
    deleteAllSharedLinks,
    isDeleting: deleteMutation.isPending,
    isDeletingAll: deleteAllMutation.isPending,
    refetch
  };
}
