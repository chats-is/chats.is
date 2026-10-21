import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { type PendingPrompt } from '@/lib/pending-prompt';
import { promptQueries } from '@/server/functions/prompt';
import { PromptDialog, type UsablePrompt } from '@/components/prompt-dialog';

/** One row's worth. Suggestions, not a browsable list — /prompts has the rest. */
const SUGGESTION_COUNT = 4;

interface PromptSuggestionsProps {
  /** Current composer text; a prompt is prepended rather than replacing it. */
  currentValue: string;
  onInsert: (value: string) => void;
  /** A prompt tried from its dialog, sent in this chat. */
  onTry: (prompt: PendingPrompt) => void;
  disabled?: boolean;
}

function prependPrompt(promptContent: string, currentValue: string) {
  const content = promptContent.trim();
  if (!currentValue.trim()) {
    return content;
  }

  return `${content}\n\n${currentValue.trimStart()}`;
}

function pickRandom<T>(items: T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/**
 * A few prompts offered under the composer on a new chat.
 *
 * Replaces the picker that used to sit inside the composer: a prompt seeds a
 * first message, so it belongs to the empty state rather than to a control that
 * stays for the whole conversation.
 *
 * Suggestions, not a browser — a random handful; /prompts in the sidebar is
 * where the full list lives. An earlier version put search and paging here,
 * which gave the section chrome to render before it knew whether it had
 * anything to show: a user with no prompts watched a search box appear and
 * then vanish.
 */
export function PromptSuggestions({
  currentValue,
  onInsert,
  onTry,
  disabled = false
}: PromptSuggestionsProps) {
  const { data: prompts } = useQuery(promptQueries.usable());

  // The prompt open in its dialog, kept after it closes so the dialog has
  // something to show on its way out.
  const [opened, setOpened] = useState<UsablePrompt | null>(null);
  const [open, setOpen] = useState(false);

  // A prompt that needs a reference opens as it does in the gallery, and is
  // tried in this chat: put in the composer, it would go without what it
  // needs. Any other's words go in the composer, as before.
  const use = (prompt: UsablePrompt) => {
    if (prompt.needsReference) {
      setOpened(prompt);
      setOpen(true);
      return;
    }
    onInsert(prependPrompt(prompt.content, currentValue));
  };

  // Shuffled once per query result rather than per render — re-picking as the
  // user types would shuffle the cards under their cursor.
  const suggestions = useMemo(
    () => pickRandom(prompts ?? [], SUGGESTION_COUNT),
    [prompts]
  );

  // Nothing renders until there is something to suggest, so there is no empty
  // frame to flash while the query is in flight.
  if (!suggestions.length) {
    return null;
  }

  return (
    <div className="mx-auto mt-4 w-full max-w-4xl">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {suggestions.map(prompt => (
          <button
            key={prompt.id}
            type="button"
            disabled={disabled}
            onClick={() => use(prompt)}
            className="flex min-h-20 flex-col gap-1 overflow-hidden rounded-2xl border bg-background p-2.5 text-left shadow-xs transition-[border-color,background-color,box-shadow] hover:border-accent-foreground/15 hover:bg-accent/30 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="truncate text-xs font-medium text-foreground/90">
              {prompt.name}
            </span>
            <span className="line-clamp-2 text-[11px] leading-4 whitespace-pre-wrap text-muted-foreground">
              {prompt.content}
            </span>
          </button>
        ))}
      </div>
      {opened && (
        <PromptDialog
          prompt={opened}
          open={open}
          onOpenChange={setOpen}
          onTry={onTry}
        />
      )}
    </div>
  );
}
