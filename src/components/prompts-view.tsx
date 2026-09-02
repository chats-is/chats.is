import { useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import { setPendingPrompt } from '@/lib/pending-prompt';
import { listUsablePrompts, promptQueries } from '@/server/fn/prompt';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatHeader } from '@/components/chat-header';

type UsablePrompt = Awaited<ReturnType<typeof listUsablePrompts>>[number];

/** Card for a single prompt — clicking seeds it into a fresh chat composer. */
function PromptCard({ prompt }: { prompt: UsablePrompt }) {
  const router = useRouter();

  const handleUse = () => {
    setPendingPrompt(prompt.content);
    // refresh() forces a fresh `/` render (new chat id → remount) so the
    // seeding effect re-runs even when `/` is served from the router cache,
    // matching how NewContent navigates.
    router.navigate({ to: '/' });
    router.invalidate();
  };

  return (
    <button
      type="button"
      onClick={handleUse}
      title={prompt.name}
      className="group relative flex aspect-square flex-col overflow-hidden rounded-lg border bg-background text-left transition hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      {prompt.image ? (
        <>
          <img
            src={prompt.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent p-2">
            <span className="line-clamp-2 text-xs text-white">
              {prompt.name}
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="line-clamp-[10] min-h-0 flex-1 overflow-hidden p-3 text-xs whitespace-pre-wrap text-muted-foreground">
            {prompt.content}
          </p>
          <div className="px-3 pb-2.5">
            <span className="line-clamp-2 text-xs font-medium">
              {prompt.name}
            </span>
          </div>
        </>
      )}
    </button>
  );
}

export function PromptsView() {
  const { data: prompts, isLoading } = useQuery({
    ...promptQueries.usable(),
    refetchOnWindowFocus: false,
    staleTime: 60_000
  });

  return (
    <div className="flex size-full flex-col">
      <ChatHeader title="Prompts" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-4">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="aspect-square rounded-lg" />
              ))}
            </div>
          ) : prompts?.length ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {prompts.map(prompt => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Sparkles className="size-12 opacity-50" />
              <p className="text-sm">
                Prompts you and your team create will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
