import {
  createRootRouteWithContext,
  HeadContent,
  Scripts
} from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import type { QueryClient } from '@tanstack/react-query';
import { Analytics } from '@vercel/analytics/react';

import { env } from '@/lib/env';
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
    shellComponent: RootDocument
  }
);

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
