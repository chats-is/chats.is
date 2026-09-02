import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mutating } from '@/lib/mutation';
import { deleteAllShares, deleteShare, shareQueries } from '@/server/fn/share';

export function useSharedLinks(page: number = 0, limit: number = 5) {
  const offset = page * limit;
  const queryClient = useQueryClient();

  const { data, error, isLoading, refetch } = useQuery({
    ...shareQueries.list({ limit, offset }),
    staleTime: 1000 * 60 * 5
  });

  const deleteMutation = useMutation({
    mutationFn: mutating(deleteShare),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shareQueries.key.list() });
    }
  });

  const deleteAllMutation = useMutation({
    mutationFn: mutating(deleteAllShares),
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
  const sharedLinks = data?.map(share => ({
    id: share.id,
    createdAt: share.createdAt,
    chat: share.chat
  }));

  return {
    sharedLinks,
    error,
    isLoading,
    isError: !!error,
    hasMore: data ? data.length === limit : true,
    deleteSharedLink,
    deleteAllSharedLinks,
    isDeleting: deleteMutation.isPending,
    isDeletingAll: deleteAllMutation.isPending,
    refetch
  };
}
