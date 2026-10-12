import { UNAUTHORIZED } from '@/lib/constant';

export const isUnauthorized = (error: unknown) =>
  error instanceof Error && error.message === UNAUTHORIZED;
