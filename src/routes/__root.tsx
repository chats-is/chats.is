import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { type QueryClient } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';

import { env } from '@/lib/env';
import { NotFound } from '@/components/not-found';
import { Providers } from '@/components/providers';
import { TailwindIndicator } from '@/components/tailwind-indicator';

import appCss from '../styles.css?url';

/** The installation names itself; the title and description follow from that. */
const getAppSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const { getAppSettings } = await import('@/lib/queries');
  return getAppSettings();
});

/** Analytics is configured by environment, and only the two ids reach the page. */
const getAnalytics = createServerFn({ method: 'GET' }).handler(async () => ({
  scriptUrl: env.UMAMI_SCRIPT_URL ?? null,
  websiteId: env.UMAMI_WEBSITE_ID ?? null
}));

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: async () => ({
      settings: await getAppSettings(),
      analytics: await getAnalytics()
    }),
    head: ({ loaderData }) => {
      const { appName, appSubtitle, appDescription } =
        loaderData?.settings ?? {};
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
          { title: appName ? `${appName} - ${appSubtitle}` : 'chats.is' },
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

function RouteError({ error }: { error: Error }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background py-2">
      <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
        Something went wrong
      </h1>
      <p className="mt-4 max-w-xl text-center text-gray-600 dark:text-gray-400">
        {error.message}
      </p>
      <Link
        to="/"
        className="mt-6 text-blue-500 hover:underline dark:text-blue-400"
      >
        Return Home
      </Link>
    </div>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { analytics } = Route.useLoaderData();

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <HeadContent />
        {analytics.scriptUrl && analytics.websiteId && (
          <script
            defer
            src={analytics.scriptUrl}
            data-website-id={analytics.websiteId}
          />
        )}
      </head>
      <body className="h-full scroll-smooth font-sans antialiased">
        <Providers attribute="class" defaultTheme="system" enableSystem>
          {children}
          <TailwindIndicator />
          <Analytics />
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
