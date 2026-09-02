import type { InfiniteData } from '@tanstack/react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';

import { type Chat } from '@/types';
import { type Input, mutating } from '@/lib/mutation';
import {
  chatQueries,
  deleteAllChats,
  deleteChat,
  listChats,
  updateChat
} from '@/server/fn/chat';

const LIMIT = 25;

/** The one cache the sidebar reads and every edit below writes back into. */
const historyQuery = () => chatQueries.infinite({ limit: LIMIT });
type History = InfiniteData<Awaited<ReturnType<typeof listChats>>>;

export function useChatsInfinite() {
  const {
    data,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isError,
    error
  } = useInfiniteQuery({
    ...historyQuery(),
    refetchOnWindowFocus: false
  });

  const chats = data ? data.pages.flat() : [];

  return {
    chats: chats as Chat[],
    isLoading,
    isValidating: isFetching,
    fetchNextPage,
    hasMore: hasNextPage,
    isError,
    error
  };
}

export function useChats() {
  const queryClient = useQueryClient();
  const key = historyQuery().queryKey;

  /**
   * Each edit shows its result in the sidebar before the server has agreed,
   * and puts the previous list back if it doesn't. Reading, writing and
   * restoring all name the same key, so an optimistic edit cannot land in a
   * cache nothing is reading.
   */
  const snapshot = async () => {
    await queryClient.cancelQueries({ queryKey: key });
    return queryClient.getQueryData<History>(key);
  };

  const restore = (previous: History | undefined) => {
    queryClient.setQueryData(key, previous);
  };

  const settle = () => {
    queryClient.invalidateQueries({ queryKey: chatQueries.key.infinite() });
    queryClient.invalidateQueries({ queryKey: chatQueries.key.list() });
  };

  const update = useMutation({
    mutationFn: mutating(updateChat),
    onMutate: async (newChat: Input<typeof updateChat>) => {
      const previousChats = await snapshot();

      queryClient.setQueryData<History>(key, old => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map(page =>
            page.map(chat =>
              chat.id === newChat.id ? { ...chat, ...newChat } : chat
            )
          )
        };
      });

      return { previousChats };
    },
    onError: (_err, _newChat, context) => restore(context?.previousChats),
    onSettled: settle
  });

  const remove = useMutation({
    mutationFn: mutating(deleteChat),
    onMutate: async ({ id }: Input<typeof deleteChat>) => {
      const previousChats = await snapshot();

      queryClient.setQueryData<History>(key, old => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map(page => page.filter(chat => chat.id !== id))
        };
      });

      return { previousChats };
    },
    onError: (_err, _vars, context) => restore(context?.previousChats),
    onSettled: settle
  });

  const clear = useMutation({
    mutationFn: () => deleteAllChats(),
    onMutate: async () => {
      const previousChats = await snapshot();
      queryClient.setQueryData<History>(key, old =>
        old ? { ...old, pages: [], pageParams: [] } : old
      );
      return { previousChats };
    },
    onError: (_err, _vars, context) => restore(context?.previousChats),
    onSettled: settle
  });

  const refresh = () => {
    return queryClient.invalidateQueries({
      queryKey: chatQueries.key.infinite()
    });
  };

  return {
    refreshChats: refresh,
    updateChat: update.mutateAsync,
    deleteChat: remove.mutateAsync,
    clearChats: clear.mutateAsync,
    isUpdating: update.isPending,
    isDeleting: remove.isPending,
    isClearing: clear.isPending
  };
}
