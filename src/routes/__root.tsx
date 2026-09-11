import {
  createRootRouteWithContext,
  HeadContent,
  Scripts
} from '@tanstack/react-router';
import { type QueryClient } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';

import { DEFAULT_APP_NAME } from '@/lib/constant';
import { settingsQueries } from '@/server/fn/settings';
import { NotFound } from '@/components/not-found';
import { Providers } from '@/components/providers';
import { RouteError } from '@/components/route-error';
import { RouterDevtools } from '@/components/router-devtools';
import { TailwindIndicator } from '@/components/tailwind-indicator';

import appCss from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: ({ context }) =>
      context.queryClient.ensureQueryData(settingsQueries.app()),
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
          <RouterDevtools />
          <Analytics />
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
