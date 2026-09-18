import { useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatHeader } from '@/components/chat-header';
import { MyPrompts } from '@/components/my-prompts';
import { TrendingPrompts } from '@/components/trending-prompts';

const VIEW_TABS = [
  { value: 'trending', label: 'Trending' },
  { value: 'my', label: 'My Prompts' }
] as const;

type View = (typeof VIEW_TABS)[number]['value'];

export function PromptsView() {
  const navigate = useNavigate();
  // Reading the loose union of every route's search — rather than this
  // route's own `Route.useSearch` — avoids a circular import between the
  // route file and this component, which the route file already imports.
  const view = useSearch({ strict: false }).tab ?? 'trending';

  const setView = (next: View) => {
    void navigate({
      to: '.',
      search: (previous: Record<string, unknown>) => {
        const rest = { ...previous };
        delete rest.tab;
        return next === 'trending' ? rest : { ...rest, tab: next };
      },
      replace: false
    });
  };

  // Each tab keeps its own typed search, so switching tabs and back doesn't
  // clear what you'd typed in the other one.
  const [trendingSearch, setTrendingSearch] = useState('');
  const [mineSearch, setMineSearch] = useState('');
  // Bumped by the Add Prompt button; MyPrompts opens its dialog in response.
  const [createRequestId, setCreateRequestId] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const search = view === 'trending' ? trendingSearch : mineSearch;
  const setSearch = view === 'trending' ? setTrendingSearch : setMineSearch;

  return (
    <div className="flex size-full flex-col">
      <ChatHeader title="Prompts" />
      {/* Named so the router can be told, in `scrollToTopSelectors`, that this
          gallery opens at the top. Without an id it identifies a scroller by
          its position in the DOM, and the other gallery's sits in exactly the
          same place — the two would read as one element. */}
      <div
        ref={scrollRef}
        data-scroll-restoration-id="prompts"
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-9 shrink-0 items-center rounded-full border bg-muted/50 p-1">
              {VIEW_TABS.map(tab => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setView(tab.value)}
                  aria-current={view === tab.value ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors',
                    view === tab.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative min-w-40 flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or content"
                className="rounded-full pl-9"
              />
            </div>

            {view === 'my' && (
              <Button
                className="gap-2 rounded-full"
                onClick={() => setCreateRequestId(id => id + 1)}
              >
                <Plus className="size-4" />
                Add Prompt
              </Button>
            )}
          </div>

          {/* Keep Trending mounted so its infinite-scroll position and loaded
              pages survive a trip to My Prompts and back. */}
          <div className={view === 'trending' ? undefined : 'hidden'}>
            <TrendingPrompts
              active={view === 'trending'}
              scrollRef={scrollRef}
              search={trendingSearch}
            />
          </div>
          {view === 'my' && (
            <MyPrompts
              search={mineSearch}
              createRequestId={createRequestId}
              scrollRef={scrollRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
