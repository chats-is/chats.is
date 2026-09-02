import { api } from '@/trpc/react';

export function useSharedLinks(page: number = 0, limit: number = 5) {
  const offset = page * limit;
  const utils = api.useUtils();

  const { data, error, isLoading, refetch } = api.share.list.useQuery(
    { limit, offset },
    { staleTime: 1000 * 60 * 5 }
  );

  const deleteMutation = api.share.delete.useMutation({
    onSuccess: () => {
      utils.share.list.invalidate();
    }
  });

  const deleteAllMutation = api.share.deleteAll.useMutation({
    onSuccess: () => {
      utils.share.list.invalidate();
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
