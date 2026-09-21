/**
 * Asked of the parser, not of a pattern. A pattern has to anticipate every way
 * a path can turn into a host — `//host`, `/\\host` — and the one it missed
 * was a tab: URL parsing strips tabs and newlines, so `/<tab>/host` passed a
 * check for "starts with one slash" and then resolved to `//host`. What the
 * browser will do with the string is the only question, so it is put to the
 * same parser the browser uses.
 */
export const staysOnThisSite = (to: string) => {
  if (!to.startsWith('/')) return false;
  try {
    const base = 'http://app.invalid';
    return new URL(to, base).origin === base;
  } catch {
    return false;
  }
};
