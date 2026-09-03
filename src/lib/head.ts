/**
 * The one place a document title is assembled.
 *
 * Every page's title ends in the installation's own name, so a tab is
 * identifiable when a dozen of them are open and a bookmark says which app it
 * came from. The router has no notion of a title template — a route's `title`
 * is a plain string and the deepest one wins outright — so the pattern lives
 * here and the routes call it.
 */

/** Matches the fallback in `getAppSettings`, for before the settings arrive. */
const FALLBACK_APP_NAME = 'Chats.is';

/** The shape a route's head needs out of the root match. */
type RootLoaderData = {
  settings?: { appName?: string };
};

/**
 * The installation's name, read from the root route's data.
 *
 * `matches` runs root-first, so the root's loader data is the head of the list.
 * A route's own `matches` is typed against that route's loader, not the root's,
 * hence the narrowing here rather than at the call sites.
 */
export function appName(matches: Array<{ loaderData?: unknown }>): string {
  const root = matches[0]?.loaderData as RootLoaderData | undefined;
  return root?.settings?.appName || FALLBACK_APP_NAME;
}

/** `Page - App`, or just `App` for a page that does not name itself. */
export function formatTitle(page: string | undefined, app: string): string {
  return page ? `${page} - ${app}` : app;
}

/**
 * A route's `<title>`. Pass what the page calls itself; the app's name is
 * appended.
 */
export function pageTitle(
  matches: Array<{ loaderData?: unknown }>,
  page?: string
): string {
  return formatTitle(page, appName(matches));
}
