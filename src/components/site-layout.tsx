import { Link, useMatches } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { useAppName } from '@/lib/head';
import { sessionQueries } from '@/server/functions/auth';
import { Button } from '@/components/ui/button';
import { PlansDialogProvider, useOpenPlans } from '@/components/plans-dialog';
import { LoginDialogProvider, useOpenLogin } from '@/components/site-dialogs';

/** Whether the site offers its plans — only while they are on sale — read
 *  from the root route's data like the app's name. */
export function usePlansOnSale(): boolean {
  return useMatches({
    select: matches =>
      !!(matches[0]?.loaderData as { plansOnSale?: boolean } | undefined)
        ?.plansOnSale
  });
}

/**
 * The frame of every page of the site — the front page, about, the legal
 * pages and the sign-in page alike: a header that leads into the app, a
 * footer that leads to the rest of them, and over any of them the sign-in
 * dialog and the plans dialog, opened where the reader is.
 */
export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <LoginDialogProvider>
      <SiteFrame>{children}</SiteFrame>
    </LoginDialogProvider>
  );
}

/** The page itself, inside the dialogs it opens. */
function SiteFrame({ children }: { children: React.ReactNode }) {
  const openLogin = useOpenLogin();

  return (
    // Taking a plan asks someone not signed in to sign in first.
    <PlansDialogProvider onSignIn={openLogin}>
      <div className="flex min-h-svh flex-col bg-background">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </PlansDialogProvider>
  );
}

function SiteHeader() {
  const appName = useAppName();
  const plans = usePlansOnSale();
  const { data: user } = useQuery(sessionQueries.me());
  const openLogin = useOpenLogin();
  const openPlans = useOpenPlans()!;

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center gap-8 px-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-[17px] font-semibold"
        >
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="truncate">{appName}</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          {plans && (
            <button
              type="button"
              className="hover:text-foreground"
              onClick={openPlans}
            >
              Plans
            </button>
          )}
          <Link
            to="/about"
            className="hover:text-foreground"
            activeProps={{ className: 'text-foreground' }}
          >
            About
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <Button asChild size="sm" className="rounded-full px-4">
              <Link to="/">Go to Chat</Link>
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full px-4"
                onClick={openLogin}
              >
                Log in
              </Button>
              <Button
                size="sm"
                className="rounded-full px-4"
                onClick={openLogin}
              >
                Sign up for free
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  const appName = useAppName();

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()}{' '}
          <Link to="/" className="hover:text-foreground">
            {appName}
          </Link>
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/terms" className="hover:text-foreground">
            Terms of Service
          </Link>
          <Link to="/privacy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <a
            href="https://github.com/chats-is/chats.is"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
