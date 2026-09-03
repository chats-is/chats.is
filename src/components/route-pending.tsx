/**
 * What a route shows while its loader is still running.
 *
 * Without this the router has nothing to render until the data arrives, so a
 * click lands on the old page and the new one appears all at once — the wait
 * reads as the app having ignored the click. The pages carry this same
 * placeholder for their own loading state; it belongs to the route too.
 */
export function RoutePending() {
  return (
    <div className="flex h-[50vh] items-center justify-center">Loading...</div>
  );
}
