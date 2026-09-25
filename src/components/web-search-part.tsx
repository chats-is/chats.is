import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Globe, Loader2 } from 'lucide-react';

import { type ChatMessage } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type WebSearchUIPart = Extract<
  ChatMessage['parts'][number],
  { type: 'tool-web_search' }
>;

export function isWebSearchPart(
  part: ChatMessage['parts'][number]
): part is WebSearchUIPart {
  return part.type === 'tool-web_search';
}

/** One page a reply drew on. */
export type WebSource = { title: string; url: string };

/**
 * The pages a reply drew on, from wherever the provider reported them: as
 * `source-url` parts beside the text, or inside the search tool's output —
 * the delegate tool's `sources`, or whatever shape the provider's own search
 * gives its result, which is read for anything with an address. Each page
 * once, by its address.
 */
export function collectSources(parts: ChatMessage['parts']): WebSource[] {
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url) || seen.has(url)) {
      return;
    }
    seen.add(url);
    // A source with no title is named by its address, less the protocol:
    // a provider that names none sends several pages from the same site,
    // which the host alone could not tell apart.
    sources.push({
      title:
        typeof title === 'string' && title
          ? title
          : url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      url
    });
  };
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(item => walk(item, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    if ('url' in record) add(record.url, record.title);
    else Object.values(record).forEach(item => walk(item, depth + 1));
  };

  for (const part of parts) {
    if (part.type === 'source-url') {
      add(part.url, part.title);
    } else if (isWebSearchPart(part) && part.state === 'output-available') {
      walk(part.output, 0);
    }
  }
  return sources;
}

/** What was searched for: the delegate tool's input, or, for a provider's
 *  own search, whatever its result says it looked up. */
function queryOf(part: WebSearchUIPart): string | undefined {
  if (part.input?.query) return part.input.query;
  const output = part.output as { action?: { query?: unknown } } | undefined;
  const query = output?.action?.query;
  return typeof query === 'string' && query ? query : undefined;
}

/**
 * The searches a reply made, shown as its thinking is: one line that says
 * what is going on — searching, or searched — and under it, the queries. A
 * reply that searches twice at once has one block with two lines, not two
 * chips. The pages found are listed under the reply (see `MessageSources`),
 * where the text that cites them is.
 */
export function WebSearchBlock({ parts }: { parts: WebSearchUIPart[] }) {
  const searching = parts.some(
    part => part.state === 'input-streaming' || part.state === 'input-available'
  );
  // Open while searching, so it can be watched, and closed once done — as
  // the reasoning is. The reader can open or close it either way.
  const [isExpanded, setIsExpanded] = useState(searching);
  useEffect(() => {
    setIsExpanded(searching);
  }, [searching]);
  const queries = parts.map(queryOf);

  return (
    <div className="mb-2">
      <Button
        variant="link"
        size="sm"
        className="-ml-1 flex items-center gap-1 px-0 text-sm font-normal text-muted-foreground shadow-none hover:text-accent-foreground hover:no-underline disabled:opacity-100 has-[>svg]:px-0"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {searching ? (
          <>
            <Loader2 className="animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Searching the web...</span>
          </>
        ) : (
          <>
            <Globe />
            <span>
              {parts.length === 1
                ? 'Searched the web'
                : `Searched the web ${parts.length} times`}
            </span>
          </>
        )}
        <ChevronDown
          className={cn('transition-transform', { 'rotate-180': isExpanded })}
        />
      </Button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="searches"
            className="ml-[3px] border-l-2 pl-3 text-sm text-muted-foreground"
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            variants={variants}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <ul className="space-y-1">
              {parts.map((part, index) => {
                const running =
                  part.state === 'input-streaming' ||
                  part.state === 'input-available';
                const query = queries[index];
                return (
                  <li key={part.toolCallId ?? index} className="truncate">
                    {query
                      ? running
                        ? `Searching “${query}”…`
                        : `Searched “${query}”`
                      : running
                        ? 'Searching…'
                        : 'Searched'}
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const variants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: { height: 'auto', opacity: 1 }
};

/** How many sources are listed before the rest fold away. */
const SOURCES_SHOWN = 6;

/** The pages a reply drew on, listed once under it. */
export function MessageSources({ sources }: { sources: WebSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;

  const shown = expanded ? sources : sources.slice(0, SOURCES_SHOWN);
  const hidden = sources.length - shown.length;

  return (
    <div className="mt-3 text-sm">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        Sources
      </div>
      <ol className="space-y-1">
        {shown.map((source, index) => {
          const host = hostOf(source.url);
          return (
            <li key={source.url} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {index + 1}.
              </span>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                title={source.url}
                className="min-w-0 truncate text-primary hover:underline"
              >
                {source.title}
              </a>
              {/* The host, unless the title already says it. */}
              {host && !namesSite(source.title, host) && (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {host}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

/** Whether a title already says where a page is: it carries the host, or
 *  is itself one — a redirecting search names a page by its site alone. */
function namesSite(title: string, host: string): boolean {
  return title.includes(host) || /^[\w.-]+\.[a-z]{2,}$/i.test(title.trim());
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
