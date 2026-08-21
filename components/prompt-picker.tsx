'use client';

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { api } from '@/trpc/react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

interface PromptPickerProps {
  currentValue: string;
  onInsert: (value: string) => void;
  disabled?: boolean;
}

function prependPrompt(promptContent: string, currentValue: string) {
  const content = promptContent.trim();
  if (!currentValue.trim()) {
    return content;
  }

  return `${content}\n\n${currentValue.trimStart()}`;
}

export function PromptPicker({
  currentValue,
  onInsert,
  disabled = false
}: PromptPickerProps) {
  const [open, setOpen] = useState(false);

  // Prevent hydration mismatch with the Radix Popover's generated id.
  // Render a non-Radix placeholder until mounted (matches ModelMenu).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { data: prompts, isLoading } = api.prompt.listUsable.useQuery(
    undefined,
    {
      refetchOnWindowFocus: false
    }
  );

  const handleUsePrompt = (content: string) => {
    onInsert(prependPrompt(content, currentValue));
    setOpen(false);
  };

  if (!mounted) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 rounded-full text-muted-foreground shadow-none"
        disabled
      >
        <Sparkles className="size-4" />
        <span className="sr-only">Open prompts</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 rounded-full text-muted-foreground shadow-none"
          disabled={disabled}
        >
          <Sparkles className="size-4" />
          <span className="sr-only">Open prompts</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-48 max-w-[calc(100vw-1rem)] overflow-hidden p-2"
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : prompts?.length ? (
          <div className="max-h-52 overflow-x-hidden overflow-y-auto">
            <div className="mx-auto grid w-fit grid-cols-[repeat(2,5rem)] gap-2">
              {prompts.map(prompt => (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => handleUsePrompt(prompt.content)}
                  className="group h-20 w-20 overflow-hidden rounded-md border bg-background text-left shadow-xs transition-[border-color,background-color,box-shadow] hover:border-accent-foreground/15 hover:bg-accent/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {prompt.image ? (
                    <img
                      src={prompt.image}
                      alt=""
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-start p-1.5">
                      <p className="line-clamp-5 text-[9px] leading-3 whitespace-pre-wrap text-muted-foreground transition-colors group-hover:text-foreground/80">
                        {prompt.content}
                      </p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No prompts
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
