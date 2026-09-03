import { describe, expect, it } from 'vitest';

import { appName, formatTitle, pageTitle } from './head';

/** What the root route's loader returns, as a child route's `matches` sees it. */
const rootMatch = (name?: string) => ({
  loaderData: { settings: { appName: name }, analytics: {} }
});

describe('pageTitle', () => {
  it('ends a page title with the installation name', () => {
    expect(pageTitle([rootMatch('Acme'), {}], 'Prompts')).toBe(
      'Prompts - Acme'
    );
  });

  it('is the installation name alone when the page does not name itself', () => {
    expect(pageTitle([rootMatch('Acme')], undefined)).toBe('Acme');
  });

  it('reads the root match, not the route calling it', () => {
    // The leaf's own loader data must not be mistaken for the settings.
    const leaf = { loaderData: { settings: { appName: 'Wrong' } } };
    expect(pageTitle([rootMatch('Acme'), leaf], 'Users')).toBe('Users - Acme');
  });
});

describe('appName', () => {
  it('falls back before the settings have loaded', () => {
    expect(appName([])).toBe('Chats.is');
    expect(appName([{}])).toBe('Chats.is');
    expect(appName([{ loaderData: undefined }])).toBe('Chats.is');
  });

  it('falls back when the installation has been named an empty string', () => {
    expect(appName([rootMatch('')])).toBe('Chats.is');
  });
});

describe('formatTitle', () => {
  it('leaves a page out rather than trailing a separator', () => {
    expect(formatTitle(undefined, 'Acme')).toBe('Acme');
    expect(formatTitle('', 'Acme')).toBe('Acme');
  });
});
