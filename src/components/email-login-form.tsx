import * as React from 'react';
import { Loader2, Mail } from 'lucide-react';
import { signIn } from 'next-auth/react';

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
  isLoading?: string | null;
  setIsLoading?: (provider: string | null) => void;
}

export function EmailLoginForm({
  className,
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
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send verification code');
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
      const result = await signIn('email-code', {
        email,
        code,
        callbackUrl: '/',
        redirect: false
      });

      if (result?.error) {
        setError('Invalid or expired verification code');
        setIsLoading?.(null);
        return;
      }

      if (result?.ok) {
        window.location.href = '/';
      }
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
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to resend code');
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
              maxLength={6}
              value={code}
              onChange={setCode}
              disabled={loading}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || code.length !== 6}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              'Verify & Sign In'
            )}
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
