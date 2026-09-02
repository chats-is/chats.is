import { api } from '@/trpc/react';

import { type User } from '@/types';

export function useCurrentUser() {
  const { data, ...rest } = api.user.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false
  });

  return { ...rest, user: data as User | undefined, mutate: rest.refetch };
}
