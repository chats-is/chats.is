import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';

import { pageTitle } from '@/lib/head';
import { getPaddleCheckoutConfig } from '@/server/functions/subscription';

/**
 * Where a Paddle checkout opens. Paddle sends the user here with the
 * transaction in `?_ptxn=`, and Paddle.js — loaded and started on this page —
 * opens the checkout for it by itself. Paid, it goes back to the app to say
 * so; closed unpaid, back to the plans.
 *
 * Set as the default payment link in Paddle, on an approved domain.
 */
export const Route = createFileRoute('/pay/paddle')({
  loader: () => getPaddleCheckoutConfig(),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Checkout') }]
  }),
  component: PaddleCheckout
});

type PaddleJs = {
  Environment: { set: (environment: 'sandbox') => void };
  Initialize: (options: {
    token: string;
    checkout?: { settings: { displayMode: 'overlay'; successUrl: string } };
    eventCallback?: (event: { name?: string }) => void;
  }) => void;
};

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';

function PaddleCheckout() {
  const config = Route.useLoaderData();
  const [failed, setFailed] = useState(false);
  const completed = useRef(false);
  // Read in the browser: the server renders without the address's query,
  // and the two first renders must agree.
  const [hasTransaction, setHasTransaction] = useState<boolean | null>(null);
  useEffect(() => {
    setHasTransaction(new URLSearchParams(window.location.search).has('_ptxn'));
  }, []);

  useEffect(() => {
    if (!config || !hasTransaction) return;
    const origin = window.location.origin;
    // The transaction goes back with the user, so the app can ask Paddle
    // for the subscription it made if the webhook is late.
    const transaction =
      new URLSearchParams(window.location.search).get('_ptxn') ?? '';
    const script = document.createElement('script');
    script.src = PADDLE_JS;
    script.async = true;
    script.onload = () => {
      const paddle = (window as unknown as { Paddle?: PaddleJs }).Paddle;
      if (!paddle) return setFailed(true);
      if (config.sandbox) paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: config.clientToken,
        checkout: {
          settings: {
            displayMode: 'overlay',
            successUrl: `${origin}/?checkout=success&via=paddle&ref=${encodeURIComponent(transaction)}`
          }
        },
        eventCallback: event => {
          if (event.name === 'checkout.completed') completed.current = true;
          // Closed without paying: back to the plans the user came from.
          if (event.name === 'checkout.closed' && !completed.current) {
            window.location.href = `${origin}/?checkout=canceled`;
          }
        }
      });
    };
    script.onerror = () => setFailed(true);
    document.head.appendChild(script);
    return () => script.remove();
  }, [config, hasTransaction]);

  const message = !config
    ? 'Paddle checkout is not configured.'
    : hasTransaction === false
      ? 'There is no checkout to open here.'
      : failed
        ? 'The checkout could not be loaded.'
        : null;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-sm text-muted-foreground">
      {message ? (
        <>
          <p>{message}</p>
          <Link to="/" className="text-foreground underline underline-offset-4">
            Back to the app
          </Link>
        </>
      ) : (
        <p className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          Opening checkout…
        </p>
      )}
    </div>
  );
}
