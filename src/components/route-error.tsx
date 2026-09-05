import {
  Link,
  useRouter,
  type ErrorComponentProps
} from '@tanstack/react-router';

import { Button } from '@/components/ui/button';

/**
 * What a route shows when it throws.
 *
 * Registered as the router's `defaultErrorComponent`, not just the root's. On
 * the client an uncaught error climbs to the nearest boundary and the root's
 * would do; on the server it does not climb at all — a match that errored
 * renders `route.errorComponent ?? router.defaultErrorComponent` on the spot,
 * and with neither set the router draws its own unstyled notice into the HTML.
 * Setting the default is what keeps that from reaching a page.
 */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <h1 className="text-4xl font-bold text-foreground">
        Something went wrong
      </h1>

      {error.message && (
        <p className="max-w-xl text-muted-foreground">{error.message}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {/* Invalidating re-runs the loaders and hands the route a new match,
            which is also what clears the boundary — so one action covers a
            load that failed and a render that threw. `reset` alone would not:
            it is absent on the server-rendered path, and on a loader error it
            would re-render straight back into the same failure. */}
        <Button onClick={() => router.invalidate()}>Try again</Button>
        <Button variant="ghost" render={<Link to="/">Return home</Link>} />
      </div>
    </div>
  );
}
