import { useState } from 'react';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { SquareSparkles } from 'lucide-react';

import { findModel } from '@/lib/prompt';
import { cn } from '@/lib/utils';
import { GalleryCard, type GalleryCardAction } from '@/components/gallery-card';
import { ModelIcon } from '@/components/model-icon';
import { PromptDialog, type UsablePrompt } from '@/components/prompt-dialog';

/**
 * Card for a single prompt — clicking it opens the prompt, to be tried from
 * there. Shared by Trending and My Prompts: the mark of the model it presets,
 * its name and its actions along the top, its words below — or its example,
 * edge to edge — and its tags at the foot.
 * A tag narrows the gallery to it, and the tag it is already narrowed to
 * widens it again.
 */
export function PromptCard({
  prompt,
  activeTag,
  onTag,
  actions
}: {
  prompt: UsablePrompt;
  activeTag?: string;
  onTag?: (tag: string) => void;
  actions?: GalleryCardAction[];
}) {
  const [open, setOpen] = useState(false);
  const model = findModel(useSystemSettings(), prompt.modelId);
  const tags = prompt.tags ?? [];
  const onImage = !!prompt.image;

  return (
    <>
      <GalleryCard
        title={prompt.name}
        icon={
          model ? (
            <ModelIcon
              image={
                model.image || model.providers?.[0]?.provider?.image || null
              }
              // On a white disc over a picture, where a dark mark is lost.
              className={cn('size-4', onImage && 'rounded-full bg-white p-0.5')}
            />
          ) : (
            <SquareSparkles />
          )
        }
        actions={actions}
        onOpen={() => setOpen(true)}
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
      <PromptDialog prompt={prompt} open={open} onOpenChange={setOpen} />
    </>
  );
}
