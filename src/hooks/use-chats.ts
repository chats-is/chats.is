import { type Chat } from '@/types'
import { api } from '@/trpc/react'

const LIMIT = 25

export function useChatsInfinite() {
  const {
    data,
    isLoading,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isError,
    error,
  } = api.chat.list.useInfiniteQuery(
    { limit: LIMIT },
    {
      getNextPageParam: (lastPage, allPages) => {
        if (!lastPage || lastPage.length < LIMIT) return undefined
        return allPages.length * LIMIT
      },
      initialCursor: 0,
      refetchOnWindowFocus: false,
    },
  )

  const chats = data ? data.pages.flat() : []

  return {
    chats: chats as Chat[],
    isLoading,
    isValidating: isFetching,
    fetchNextPage,
    hasMore: hasNextPage,
    isError,
    error,
  }
}

export function useChats() {
  const utils = api.useUtils()

  const update = api.chat.update.useMutation({
    onMutate: async (newChat) => {
      await utils.chat.list.cancel()
      const previousChats = utils.chat.list.getInfiniteData()

      utils.chat.list.setInfiniteData({ limit: LIMIT }, (old) => {
        if (!old) return { pages: [], pageParams: [] }
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((chat) =>
              chat.id === newChat.id ? { ...chat, ...newChat } : chat,
            ),
          ),
        }
      })

      return { previousChats }
    },
    onError: (err, newChat, context) => {
      utils.chat.list.setInfiniteData({ limit: LIMIT }, context?.previousChats)
    },
    onSettled: () => {
      utils.chat.list.invalidate()
    },
  })

  const remove = api.chat.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.chat.list.cancel()
      const previousChats = utils.chat.list.getInfiniteData()

      utils.chat.list.setInfiniteData({ limit: LIMIT }, (old) => {
        if (!old) return { pages: [], pageParams: [] }
        return {
          ...old,
          pages: old.pages.map((page) => page.filter((chat) => chat.id !== id)),
        }
      })

      return { previousChats }
    },
    onError: (err, id, context) => {
      utils.chat.list.setInfiniteData({ limit: LIMIT }, context?.previousChats)
    },
    onSettled: () => {
      utils.chat.list.invalidate()
    },
  })

  const clear = api.chat.deleteAll.useMutation({
    onMutate: async () => {
      await utils.chat.list.cancel()
      const previousChats = utils.chat.list.getInfiniteData()
      utils.chat.list.setInfiniteData(
        { limit: LIMIT },
        { pages: [], pageParams: [] },
      )
      return { previousChats }
    },
    onError: (err, vars, context) => {
      utils.chat.list.setInfiniteData({ limit: LIMIT }, context?.previousChats)
    },
    onSettled: () => {
      utils.chat.list.invalidate()
    },
  })

  const refresh = () => {
    return utils.chat.list.invalidate()
  }

  return {
    refreshChats: refresh,
    updateChat: update.mutateAsync,
    deleteChat: remove.mutateAsync,
    clearChats: clear.mutateAsync,
    isUpdating: update.isPending,
    isDeleting: remove.isPending,
    isClearing: clear.isPending,
  }
}
