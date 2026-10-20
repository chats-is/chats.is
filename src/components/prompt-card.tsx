import { useRouter } from '@tanstack/react-router';
import { SquareSparkles } from 'lucide-react';

import { setPendingPrompt } from '@/lib/pending-prompt';
import { cn } from '@/lib/utils';
import { GalleryCard, type GalleryCardAction } from '@/components/gallery-card';

/**
 * Card for a single prompt — clicking it seeds it into a fresh chat composer.
 * Shared by Trending and My Prompts: its name and its actions along the top,
 * its words below — or its example, edge to edge — and its tags at the foot.
 * A tag narrows the gallery to it, and the tag it is already narrowed to
 * widens it again.
 */
export function PromptCard({
  prompt,
  activeTag,
  onTag,
  actions
}: {
  prompt: {
    name: string;
    content: string;
    image: string | null;
    tags: string[] | null;
  };
  activeTag?: string;
  onTag?: (tag: string) => void;
  actions?: GalleryCardAction[];
}) {
  const router = useRouter();
  const tags = prompt.tags ?? [];
  const onImage = !!prompt.image;

  const handleUse = () => {
    setPendingPrompt(prompt.content);
    // refresh() forces a fresh `/` render (new chat id → remount) so the
    // seeding effect re-runs even when `/` is served from the router cache,
    // matching how NewContent navigates.
    router.navigate({ to: '/' });
    router.invalidate();
  };

  return (
    <GalleryCard
      title={prompt.name}
      icon={<SquareSparkles />}
      actions={actions}
      onOpen={handleUse}
      media={
        onImage && (
          <img
            src={prompt.image!}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        )
      }
      footer={
        tags.length > 0 && (
          <div className="flex gap-1 overflow-hidden">
            {tags.map(tag => {
              const on = tag === activeTag;
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  disabled={!onTag}
                  onClick={() => onTag?.(tag)}
                  className={cn(
                    'pointer-events-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] leading-4 transition-colors disabled:pointer-events-none',
                    onImage
                      ? on
                        ? 'bg-white text-black'
                        : 'bg-white/20 text-white backdrop-blur-sm hover:bg-white/35'
                      : on
                        ? 'border border-primary bg-primary text-primary-foreground'
                        : 'border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )
      }
    >
      {!onImage && (
        // Faded out along the bottom, where the card cuts it off.
        <p className="h-full mask-b-from-75% text-xs whitespace-pre-wrap text-muted-foreground">
          {prompt.content}
        </p>
      )}
    </GalleryCard>
  );
}
