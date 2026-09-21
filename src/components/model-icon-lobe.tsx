import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent
} from 'react';

import { cn } from '@/lib/utils';

/**
 * One loader per drawing, keyed by where the package keeps it.
 *
 * The package exports every brand from one entry, and an icon is chosen by a
 * name out of the database — so reaching it through that entry meant the
 * bundler could drop nothing, and showing one logo downloaded all three
 * hundred of them: five megabytes, for every reader.
 *
 * What is loaded instead is the drawing itself — `Mono.js`, `Color.js` — and
 * not the icon's own `index.js`. That index also wires up an avatar and a
 * lock-up, which bring a component library and a CSS-in-JS runtime with them;
 * the drawings import React and nothing else. It is the difference between a
 * kilobyte and the weight that made this slow — and in development, where
 * these files are served as they are rather than bundled, it is the difference
 * between working and not: that runtime reaches a CommonJS module the browser
 * cannot import.
 */
type Drawing = ComponentType<{ className?: string }>;

const loaders = import.meta.glob<{ default: Drawing }>([
  '/node_modules/@lobehub/icons/es/*/components/*.js',
  '!**/Avatar.js',
  '!**/Combine.js'
]);

const loaderFor = (name: string, variant: string) =>
  loaders[
    `/node_modules/@lobehub/icons/es/${name}/components/${variant}.js`
  ] as (() => Promise<{ default: Drawing }>) | undefined;

/** Lazy components are identities React suspends on, so each is made once. */
const resolved = new Map<string, LazyExoticComponent<Drawing>>();

function iconFor(image: string): LazyExoticComponent<Drawing> | null {
  const known = resolved.get(image);
  if (known) return known;

  // "Google" is the plain mark; "Gemini.Color" names one of its variants. A
  // variant this does not load — the avatar, the lock-up — still names a
  // brand, and the brand's mark is a better answer than an empty space.
  const [name, variant = 'Mono'] = image.split('.');
  const load = loaderFor(name, variant) ?? loaderFor(name, 'Mono');
  if (!load) return null;

  const icon = lazy(load);
  resolved.set(image, icon);
  return icon;
}

/**
 * Resolves a provider's icon by name. Kept in its own module so the icon set
 * is only ever reached from the browser — see model-icon.tsx.
 */
export default function LobeIcon({
  image,
  className
}: {
  image: string;
  className?: string;
}) {
  const Icon = iconFor(image);
  if (!Icon) return null;

  return (
    <Suspense fallback={<span className={cn('size-5', className)} />}>
      <Icon className={cn('size-5', className)} />
    </Suspense>
  );
}
