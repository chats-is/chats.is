import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { pageTitle } from '@/lib/head';
import { staysOnThisSite } from '@/lib/safe-redirect';
import { getSignInMethods, sessionQueries } from '@/server/functions/auth';
import { LoginForm } from '@/components/login-form';
import { RoutePending } from '@/components/route-pending';

/**
 * Where to go once signed in. Only a path inside this app: a crafted link
 * carrying a full URL — or a protocol-relative `//host` — would otherwise
 * bounce someone off-site the moment they signed in. Anything else is
 * dropped rather than rejected, so a bad link still reaches the form.
 */
const searchSchema = z.object({
  redirect: z.string().refine(staysOnThisSite).optional().catch(undefined)
});

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search }) => {
    // Already signed in — go where they were headed.
    if (await context.queryClient.ensureQueryData(sessionQueries.me())) {
      throw redirect({ href: search.redirect ?? '/' });
    }
  },
  loader: () => getSignInMethods(),
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Sign in') }] }),
  pendingComponent: RoutePending,
  component: LoginPage
});

function LoginPage() {
  const methods = Route.useLoaderData();
  const { redirect: redirectTo } = Route.useSearch();

  return (
    <div className="flex size-full items-center justify-center">
      <div className="mx-6 w-full sm:w-[350px]">
        <LoginForm {...methods} redirectTo={redirectTo ?? '/'} />
      </div>
    </div>
  );
}
