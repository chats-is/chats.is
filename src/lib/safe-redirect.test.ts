import { describe, expect, it } from 'vitest';

import { staysOnThisSite } from './safe-redirect';

describe('staysOnThisSite', () => {
  it('takes a path inside the app', () => {
    for (const to of ['/', '/chat/abc', '/console/models?page=2#top']) {
      expect(staysOnThisSite(to)).toBe(true);
    }
  });

  it('refuses every spelling of somewhere else', () => {
    for (const to of [
      'https://evil.test/',
      '//evil.test',
      '/\\evil.test',
      // Tabs and newlines are stripped by URL parsing, which turns each of
      // these into `//evil.test` after a "one leading slash" check has passed.
      '/\t/evil.test',
      '/\n/evil.test',
      '/\r/evil.test',
      'javascript:alert(1)',
      'chat/abc',
      ''
    ]) {
      expect(staysOnThisSite(to)).toBe(false);
    }
  });
});
