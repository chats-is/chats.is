import { type ReactElement, type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

export type GalleryCardAction = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
};

/** A card's actions show on hover, or once something in the card has focus
 *  from the keyboard — not from a click, which leaves focus behind on, say,
 *  the play button, and would keep them up after the pointer has gone. */
const SHOWN_ON_HOVER =
  'opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100';

/**
 * The square card the Library and Prompts are both made of: its icon, its
 * title and its actions along the top, what it holds below, and an optional
 * foot. With `media` — a picture or a video — that fills the card edge to
 * edge under all of it, with shade along the top and the foot for what lies
 * over it.
 *
 * The card's own button lies under everything else rather than around it, so
 * each action, and anything in the body or the foot that is a control of its
 * own, is one: those opt back in to the pointer with `pointer-events-auto`.
 * `wrapOpen` hands that button to something that opens from it, as a dialog's
 * trigger does; without `onOpen` or `wrapOpen` the card opens nothing.
 */
export function GalleryCard({
  icon,
  title,
  titleNote,
  actions = [],
  media,
  children,
  footer,
  onOpen,
  wrapOpen
}: {
  icon: ReactNode;
  title: string;
  /** Beside the title, quieter: a kind or a language. */
  titleNote?: string;
  actions?: GalleryCardAction[];
  media?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onOpen?: () => void;
  wrapOpen?: (button: ReactElement) => ReactNode;
}) {
  const onMedia = !!media;
  const opens = !!onOpen || !!wrapOpen;
  const surface =
    'absolute inset-0 overflow-hidden rounded-2xl border bg-background transition group-hover:bg-muted';

  const ground = (
    <>
      {media}
      {onMedia && (
        <>
          <span className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-linear-to-b from-black/60 to-transparent" />
          {footer && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-black/60 to-transparent" />
          )}
        </>
      )}
    </>
  );

  const button = (
    <button
      type="button"
      onClick={onOpen}
      aria-label={title}
      // Hovered with the card, not the button alone: what lies over it is
      // the card too.
      className={cn(
        surface,
        'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden'
      )}
    >
      {ground}
    </button>
  );

  return (
    <div className="group relative aspect-square overflow-hidden rounded-2xl">
      {opens ? (
        wrapOpen ? (
          wrapOpen(button)
        ) : (
          button
        )
      ) : (
        <div className={surface}>{ground}</div>
      )}

      <div className="pointer-events-none relative flex h-full flex-col gap-2 px-3 py-2.5">
        <div className="relative flex items-center gap-2">
          <span
            className={cn(
              'flex shrink-0 items-center [&_svg]:size-4',
              onMedia && 'text-white'
            )}
          >
            {icon}
          </span>
          <div
            className={cn(
              'min-w-0 flex-1 truncate text-sm font-medium',
              onMedia && 'text-white'
            )}
          >
            {title}
          </div>
          {titleNote && (
            <div
              className={cn(
                'shrink-0 text-xs',
                onMedia ? 'text-white/80' : 'text-muted-foreground'
              )}
            >
              {titleNote}
            </div>
          )}
          {actions.length > 0 && (
            // Over the end of the line rather than beside it, so the title has
            // the whole line until the card is pointed at — on a ground that
            // hides what it covers: the card's hovered colour, or over a
            // picture each button's own dark disc, as the Library's were.
            <div
              className={cn(
                'absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-0.5',
                onMedia ? 'gap-1' : 'bg-muted pl-1',
                SHOWN_ON_HOVER
              )}
            >
              {actions.map(action => (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={action.label}
                      onClick={action.onClick}
                      className={cn(
                        'pointer-events-auto flex size-6 items-center justify-center rounded-full',
                        onMedia
                          ? 'bg-black text-white hover:bg-neutral-700'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <action.icon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{action.label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {footer}
      </div>
    </div>
  );
}
