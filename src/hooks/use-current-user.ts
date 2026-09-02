import { useQuery } from '@tanstack/react-query';

import { type User } from '@/types';
import { userQueries } from '@/server/fn/user';

export function useCurrentUser() {
  const { data, ...rest } = useQuery({
    ...userQueries.me(),
    retry: false,
    refetchOnWindowFocus: false
  });

  return { ...rest, user: data as User | undefined, mutate: rest.refetch };
}
