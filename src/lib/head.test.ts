import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_NAME } from '@/lib/constant';

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
  // Against the constant, not a copy of its value: the point of the test is
  // that the fallback is reached, and a rename should not have to visit here.
  it('falls back before the settings have loaded', () => {
    expect(appName([])).toBe(DEFAULT_APP_NAME);
    expect(appName([{}])).toBe(DEFAULT_APP_NAME);
    expect(appName([{ loaderData: undefined }])).toBe(DEFAULT_APP_NAME);
  });

  it('falls back when the installation has been named an empty string', () => {
    expect(appName([rootMatch('')])).toBe(DEFAULT_APP_NAME);
  });
});

describe('formatTitle', () => {
  it('leaves a page out rather than trailing a separator', () => {
    expect(formatTitle(undefined, 'Acme')).toBe('Acme');
    expect(formatTitle('', 'Acme')).toBe('Acme');
  });
});
