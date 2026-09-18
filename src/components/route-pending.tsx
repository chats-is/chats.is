import { Loader2 } from 'lucide-react';

/**
 * What a route shows while its loader is still running.
 *
 * Without this the router has nothing to render until the data arrives, so a
 * click lands on the old page and the new one appears all at once — the wait
 * reads as the app having ignored the click.
 *
 * Fills whatever it is given rather than claiming a height of its own: a route
 * that has not rendered yet has no layout to sit inside, so the spinner centres
 * on the screen instead of on a box that is not there.
 */
export function RoutePending() {
  return (
    <div className="flex size-full min-h-svh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
