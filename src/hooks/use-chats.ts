import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from '@tanstack/react-query';

import { type Chat } from '@/types';
import { mutating } from '@/lib/mutation';
import {
  chatQueries,
  deleteAllChats,
  deleteChat,
  updateChat
} from '@/server/fn/chat';

const LIMIT = 25;

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
    ...chatQueries.list({ limit: LIMIT }),
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < LIMIT) return undefined;
      return allPages.length * LIMIT;
    },
    initialCursor: 0,
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

  const update = useMutation({
    mutationFn: mutating(updateChat),
    onMutate: async newChat => {
      await queryClient.cancelQueries({ queryKey: chatQueries.key.list() });
      const previousChats = utils.chat.list.getInfiniteData();

      utils.chat.list.setInfiniteData({ limit: LIMIT }, old => {
        if (!old) return { pages: [], pageParams: [] };
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
    onError: (err, newChat, context) => {
      utils.chat.list.setInfiniteData({ limit: LIMIT }, context?.previousChats);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: chatQueries.key.list() });
    }
  });

  const remove = useMutation({
    mutationFn: mutating(deleteChat),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: chatQueries.key.list() });
      const previousChats = utils.chat.list.getInfiniteData();

      utils.chat.list.setInfiniteData({ limit: LIMIT }, old => {
        if (!old) return { pages: [], pageParams: [] };
        return {
          ...old,
          pages: old.pages.map(page => page.filter(chat => chat.id !== id))
        };
      });

      return { previousChats };
    },
    onError: (err, id, context) => {
      utils.chat.list.setInfiniteData({ limit: LIMIT }, context?.previousChats);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: chatQueries.key.list() });
    }
  });

  const clear = useMutation({
    mutationFn: mutating(deleteAllChats),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: chatQueries.key.list() });
      const previousChats = utils.chat.list.getInfiniteData();
      utils.chat.list.setInfiniteData(
        { limit: LIMIT },
        { pages: [], pageParams: [] }
      );
      return { previousChats };
    },
    onError: (err, vars, context) => {
      utils.chat.list.setInfiniteData({ limit: LIMIT }, context?.previousChats);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: chatQueries.key.list() });
    }
  });

  const refresh = () => {
    return queryClient.invalidateQueries({ queryKey: chatQueries.key.list() });
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
