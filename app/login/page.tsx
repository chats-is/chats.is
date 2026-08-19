import { type Metadata } from 'next';
import { redirect } from 'next/navigation';

import { env } from '@/lib/env';
import { getVerifiedSession } from '@/server/auth';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = {
  title: 'Sign in'
};

export default async function Page() {
  const session = await getVerifiedSession();
  // redirect to home if user is already logged in
  if (session?.user) {
    redirect('/');
  }

  return (
    <div className="flex size-full items-center justify-center">
      <div className="mx-6 w-full sm:w-[350px]">
        <LoginForm
          emailEnabled={env.AUTH_EMAIL_ENABLED}
          githubEnabled={env.AUTH_GITHUB_ENABLED}
          googleEnabled={env.AUTH_GOOGLE_ENABLED}
        />
      </div>
    </div>
  );
}
