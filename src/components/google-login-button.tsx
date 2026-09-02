import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { signIn } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { IconGoogle } from '@/components/icons';

interface GoogleLoginButtonProps extends Omit<
  React.ComponentProps<typeof Button>,
  'children' | 'disabled' | 'onClick'
> {
  isLoading?: string | null;
  setIsLoading?: (provider: string | null) => void;
}

export function GoogleLoginButton({
  isLoading = null,
  setIsLoading,
  ...buttonProps
}: GoogleLoginButtonProps) {
  const disabled = isLoading !== null;

  const handleSignIn = () => {
    setIsLoading?.('google');
    signIn('google', { callbackUrl: '/' });
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
      {isLoading === 'google' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <IconGoogle className="size-4" />
      )}
      <span className="ml-2">Continue with Google</span>
    </Button>
  );
}
