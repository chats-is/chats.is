import { TanStackDevtools } from '@tanstack/react-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';

/**
 * The router's own inspector — which routes matched, what each loader is doing,
 * how long a pending state has been up.
 *
 * The panel is already a no-op outside development, but the shell that hosts it
 * is not, so the guard is here rather than left to the packages.
 */
export function RouterDevtools() {
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <TanStackDevtools
      plugins={[
        {
          name: 'TanStack Router',
          render: <TanStackRouterDevtoolsPanel />
        }
      ]}
    />
  );
}
