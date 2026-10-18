import { cn } from '@/lib/utils';

/**
 * The mark: a C that is a speech bubble, and the dot of the name in the
 * brand's blue. The C is drawn in the text colour, so it follows the theme
 * where an image could not. A `label` names it to a screen reader where
 * nothing beside it does.
 */
export function Logo({
  label,
  className
}: {
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-7 shrink-0', className)}
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true })}
    >
      <path
        d="M22.07 7.93A10 10 0 1 0 22.07 22.07"
        fill="none"
        stroke="currentColor"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <path d="M6 19.5 4 29l7.5-4.5Z" fill="currentColor" />
      <circle cx="25.5" cy="15" r="3" className="fill-brand" />
    </svg>
  );
}
