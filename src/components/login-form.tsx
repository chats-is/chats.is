import * as React from 'react';
import { Link } from '@tanstack/react-router';

import { EmailLoginForm } from '@/components/email-login-form';
import { GitHubLoginButton } from '@/components/github-login-button';
import { GoogleLoginButton } from '@/components/google-login-button';

interface LoginFormProps {
  /** Where to land once signed in; the login route has already vetted it. */
  redirectTo: string;
  emailEnabled: boolean;
  githubEnabled: boolean;
  googleEnabled: boolean;
}

export function LoginForm({
  redirectTo,
  emailEnabled,
  githubEnabled,
  googleEnabled
}: LoginFormProps) {
  const [isLoading, setIsLoading] = React.useState<string | null>(null);
  const hasOAuthProviders = githubEnabled || googleEnabled;

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to your account
        </h1>
      </div>

      {emailEnabled && (
        <EmailLoginForm
          redirectTo={redirectTo}
          isLoading={isLoading}
          setIsLoading={setIsLoading}
        />
      )}

      {emailEnabled && hasOAuthProviders && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or continue with
            </span>
          </div>
        </div>
      )}

      {hasOAuthProviders && (
        <div className="flex flex-col space-y-4">
          {githubEnabled && (
            <GitHubLoginButton
              redirectTo={redirectTo}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
            />
          )}
          {googleEnabled && (
            <GoogleLoginButton
              redirectTo={redirectTo}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
            />
          )}
        </div>
      )}

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        By signing in, you agree to our{' '}
        <Link
          to="/privacy"
          className="underline underline-offset-2 hover:text-primary"
        >
          Privacy Policy
        </Link>
        {', '}
        This is an open source project{' '}
        <a
          href="https://github.com/chats-is/chats.is"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-primary"
        >
          View on GitHub
        </a>
        .
      </p>
    </div>
  );
}
