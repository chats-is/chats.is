import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useLocation
} from '@tanstack/react-router';
import { type QueryClient } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';

import {
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_NAME,
  DEFAULT_APP_SUBTITLE
} from '@/lib/constant';
import { settingsQueries } from '@/server/functions/settings';
import { NotFound } from '@/components/not-found';
import { Providers } from '@/components/providers';
import { RouteError } from '@/components/route-error';
import { RouterDevtools } from '@/components/router-devtools';
import { TailwindIndicator } from '@/components/tailwind-indicator';

import appCss from '../styles.css?url';

/**
 * The page a preview runs in. It is a route like any other, so it sits under
 * this one and inherits the document — but it is not a page anyone visits. It
 * is opened once per artifact, inside a sandbox, to run code a model wrote.
 * Read as a visit it costs a settings query each time and is counted by the
 * analytics as a page view; neither belongs to it, and an analytics script has
 * no business in the same document as that code.
 */
const PREVIEW_FRAME = '/artifact-preview-frame';

const FRAME_SETTINGS = {
  appName: DEFAULT_APP_NAME,
  appSubtitle: DEFAULT_APP_SUBTITLE,
  appDescription: DEFAULT_APP_DESCRIPTION,
  umamiScriptUrl: null,
  umamiWebsiteId: null
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: ({ context, location }) =>
      location.pathname === PREVIEW_FRAME
        ? FRAME_SETTINGS
        : context.queryClient.ensureQueryData(settingsQueries.app()),
    head: ({ loaderData }) => {
      const { appName, appSubtitle, appDescription } = loaderData ?? {};
      return {
        meta: [
          { charSet: 'utf-8' },
          {
            name: 'viewport',
            content:
              'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no'
          },
          {
            name: 'theme-color',
            media: '(prefers-color-scheme: light)',
            content: 'white'
          },
          {
            name: 'theme-color',
            media: '(prefers-color-scheme: dark)',
            content: 'black'
          },
          {
            title: appName ? `${appName} - ${appSubtitle}` : DEFAULT_APP_NAME
          },
          { name: 'description', content: appDescription }
        ],
        links: [
          { rel: 'stylesheet', href: appCss },
          { rel: 'icon', href: '/favicon.svg' },
          { rel: 'shortcut icon', href: '/favicon.png' },
          { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
        ]
      };
    },
    // An address that matches nothing, and a route that threw, each get a page
    // rather than the router's bare fallback.
    notFoundComponent: NotFound,
    errorComponent: RouteError,
    shellComponent: RootDocument
  }
);

function RootDocument({ children }: { children: React.ReactNode }) {
  const { umamiScriptUrl, umamiWebsiteId } = Route.useLoaderData();
  const isPreviewFrame = useLocation({
    select: location => location.pathname === PREVIEW_FRAME
  });

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <HeadContent />
        {umamiScriptUrl && umamiWebsiteId && (
          <script defer src={umamiScriptUrl} data-website-id={umamiWebsiteId} />
        )}
      </head>
      <body className="h-full scroll-smooth font-sans antialiased">
        <Providers attribute="class" defaultTheme="system" enableSystem>
          {children}
          <TailwindIndicator />
          {!isPreviewFrame && <RouterDevtools />}
          {!isPreviewFrame && <Analytics />}
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
