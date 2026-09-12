import { useQuery } from '@tanstack/react-query';

import { type User } from '@/types';
import { userQueries } from '@/server/functions/user';

export function useCurrentUser() {
  const { data, ...rest } = useQuery(userQueries.me());

  return { ...rest, user: data as User | undefined, mutate: rest.refetch };
}
