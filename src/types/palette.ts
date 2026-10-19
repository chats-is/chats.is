import { type PALETTES } from '@/lib/constant';

/** A colour palette the app can be drawn in. */
export type Palette = (typeof PALETTES)[number]['value'];
