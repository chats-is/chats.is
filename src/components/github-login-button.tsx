import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { IconGitHub } from '@/components/icons';

interface GitHubLoginButtonProps extends Omit<
  React.ComponentProps<typeof Button>,
  'children' | 'disabled' | 'onClick'
> {
  /** Where to land once signed in; the login route has already vetted it. */
  redirectTo: string;
  isLoading?: string | null;
  setIsLoading?: (provider: string | null) => void;
}

export function GitHubLoginButton({
  redirectTo,
  isLoading = null,
  setIsLoading,
  ...buttonProps
}: GitHubLoginButtonProps) {
  const disabled = isLoading !== null;

  const handleSignIn = () => {
    setIsLoading?.('github');
    authClient.signIn.social({ provider: 'github', callbackURL: redirectTo });
  };

  return (
    <Button
      {...buttonProps}
      variant="outline"
      size="lg"
      onClick={handleSignIn}
      disabled={disabled}
      className="w-full"
    >
      {isLoading === 'github' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <IconGitHub className="size-4" />
      )}
      <span className="ml-2">Continue with GitHub</span>
    </Button>
  );
}
