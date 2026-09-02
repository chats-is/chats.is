import { type User } from '@/types'
import { api } from '@/trpc/react'

export function useCurrentUser() {
  const { data, ...rest } = api.user.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  })

  return { ...rest, user: data as User | undefined, mutate: rest.refetch }
}
