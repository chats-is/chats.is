import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { env } from '@/lib/env';
import { requireUser } from '@/server/fn/auth';
import { LoginForm } from '@/components/login-form';

/** Which ways in are configured; the form shows only those. */
const getSignInMethods = createServerFn({ method: 'GET' }).handler(async () => ({
  emailEnabled: env.AUTH_EMAIL_ENABLED,
  githubEnabled: env.AUTH_GITHUB_ENABLED,
  googleEnabled: env.AUTH_GOOGLE_ENABLED
}));

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async () => {
    // Already signed in — there is nothing to do here.
    if (await requireUser()) {
      throw redirect({ to: '/' });
    }
  },
  loader: () => getSignInMethods(),
  head: () => ({ meta: [{ title: 'Sign in' }] }),
  component: LoginPage
});

function LoginPage() {
  const methods = Route.useLoaderData();

  return (
    <div className="flex size-full items-center justify-center">
      <div className="mx-6 w-full sm:w-[350px]">
        <LoginForm {...methods} />
      </div>
    </div>
  );
}
