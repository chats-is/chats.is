import { useCallback, useState } from 'react';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';

import { type Palette } from '@/types/palette';
import { PALETTES } from '@/lib/constant';

/** The cookie the chosen palette is kept in, in the reader's browser. */
const PALETTE_COOKIE = 'palette';
/** A year: a palette is chosen once and kept. */
const PALETTE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEFAULT_PALETTE: Palette = PALETTES[0].value;

const palette = (value: string | undefined): Palette =>
  PALETTES.find(item => item.value === value)?.value ?? DEFAULT_PALETTE;

/**
 * Read from the cookie on whichever side renders, so the server already
 * draws the page in the chosen palette and it does not change colour after
 * loading. The artifact preview runs this document in a sandbox with no
 * origin, where reading the cookie throws; it has the default.
 */
export const readPalette = createIsomorphicFn()
  .server(() => palette(getCookie(PALETTE_COOKIE)))
  .client(() => {
    try {
      return palette(
        document.cookie
          .split('; ')
          .find(item => item.startsWith(`${PALETTE_COOKIE}=`))
          ?.slice(PALETTE_COOKIE.length + 1)
      );
    } catch {
      return DEFAULT_PALETTE;
    }
  });

/** The attribute <html> carries for a palette; none for the default. */
export const paletteAttribute = (value: Palette) =>
  value === DEFAULT_PALETTE ? undefined : value;

/** The palette in use, and the setter that applies and remembers it. */
export function usePalette() {
  const [current, setCurrent] = useState(readPalette);

  const changePalette = useCallback((next: Palette) => {
    setCurrent(next);
    document.cookie = `${PALETTE_COOKIE}=${next}; path=/; max-age=${PALETTE_COOKIE_MAX_AGE}`;
    // The document is drawn by the root, which read the palette when it
    // rendered; it is changed here so the page follows at once.
    const attribute = paletteAttribute(next);
    if (attribute) document.documentElement.dataset.palette = attribute;
    else delete document.documentElement.dataset.palette;
  }, []);

  return [current, changePalette] as const;
}
