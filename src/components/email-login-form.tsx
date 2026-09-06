import * as React from 'react';
import { Loader2, Mail } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot
} from '@/components/ui/input-otp';

interface EmailLoginFormProps {
  className?: string;
  /** Where to land once signed in; the login route has already vetted it. */
  redirectTo: string;
  isLoading?: string | null;
  setIsLoading?: (provider: string | null) => void;
}

/** How many digits the sign-in code has. */
const CODE_LENGTH = 6;

export function EmailLoginForm({
  className,
  redirectTo,
  isLoading = null,
  setIsLoading
}: EmailLoginFormProps) {
  const disabled = isLoading !== null && isLoading !== 'email';
  const loading = isLoading === 'email';
  const [step, setStep] = React.useState<'email' | 'code'>('email');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [countdown, setCountdown] = React.useState(0);

  React.useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading?.('email');

    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in'
      });

      if (error) {
        setError(error.message || 'Failed to send verification code');
        setIsLoading?.(null);
        return;
      }

      setStep('code');
      setCountdown(60);
      setIsLoading?.(null);
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading?.(null);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading?.('email');

    try {
      const { error } = await authClient.signIn.emailOtp({
        email,
        otp: code
      });

      if (error) {
        setError('Invalid or expired verification code');
        setIsLoading?.(null);
        return;
      }

      window.location.href = redirectTo;
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading?.(null);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    setError(null);
    setIsLoading?.('email');

    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'sign-in'
      });

      if (error) {
        setError(error.message || 'Failed to resend code');
        setIsLoading?.(null);
        return;
      }

      setCountdown(60);
      setIsLoading?.(null);
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading?.(null);
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {step === 'email' ? (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div className="relative">
            <Mail className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="pl-10"
              required
              disabled={disabled || loading}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            variant="outline"
            size="lg"
            className="w-full"
            disabled={disabled || loading || !email}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            <span className="ml-2">Continue with Email</span>
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            We sent a verification code to{' '}
            <span className="font-medium text-foreground">{email}</span>
          </p>
          <div className="flex justify-center">
            <InputOTP
              maxLength={CODE_LENGTH}
              value={code}
              onChange={setCode}
              disabled={loading}
            >
              <InputOTPGroup>
                {Array.from({ length: CODE_LENGTH }, (_, index) => (
                  // Bigger than the default box: this is the only thing on the
                  // screen at this point, and the digits are read back off a
                  // phone one at a time.
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="size-12 text-lg"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {/* Centred like everything else in this step: the message belongs to
              the boxes above it, which sit in the middle of the card. */}
          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || code.length !== CODE_LENGTH}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : 'Sign In'}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
                setIsLoading?.(null);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Change email
            </button>
            <button
              type="button"
              onClick={handleResendCode}
              disabled={countdown > 0 || loading}
              className={cn(
                'text-muted-foreground',
                countdown > 0 ? 'cursor-not-allowed' : 'hover:text-foreground'
              )}
            >
              {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
