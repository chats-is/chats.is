import { useEffect, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Globe, Loader2 } from 'lucide-react';

import { type ChatMessage } from '@/types';
import { GEMINI_WEB_SEARCH_TOOL_NAME } from '@/lib/constant';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type ChatPart = ChatMessage['parts'][number];

/** A search: the delegate's tool or a provider's own, under the tool's name —
 *  or Gemini's, which the SDK reports as a tool it has no schema for, named
 *  by its kind. */
export type WebSearchUIPart =
  | Extract<ChatPart, { type: 'tool-web_search' }>
  | Extract<ChatPart, { type: 'dynamic-tool' }>;

export function isWebSearchPart(part: ChatPart): part is WebSearchUIPart {
  return (
    part.type === 'tool-web_search' ||
    (part.type === 'dynamic-tool' &&
      part.toolName === GEMINI_WEB_SEARCH_TOOL_NAME)
  );
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
  const byUrl = new Map<string, WebSource>();
  const untitled = new Set<string>();
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return;
    const named = typeof title === 'string' && !!title;
    const known = byUrl.get(url);
    if (known) {
      // Found by a search whose result names no page, then cited by title.
      if (named && untitled.delete(url)) known.title = title;
      return;
    }
    if (!named) untitled.add(url);
    // A source with no title is named by its address, less the protocol:
    // a provider that names none sends several pages from the same site,
    // which the host alone could not tell apart.
    byUrl.set(url, {
      title: named ? title : url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
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
  return [...byUrl.values()];
}

/** What was searched for: the delegate tool's input, Gemini's — which runs
 *  several queries in one search — or, for another provider's own search,
 *  whatever its result says it looked up. */
function queriesOf(part: WebSearchUIPart): string[] {
  const input = part.input as
    { query?: unknown; queries?: unknown } | undefined;
  if (typeof input?.query === 'string' && input.query) return [input.query];
  if (Array.isArray(input?.queries)) {
    return input.queries.filter(
      (query): query is string => typeof query === 'string' && !!query
    );
  }
  const output = part.output as { action?: { query?: unknown } } | undefined;
  const query = output?.action?.query;
  return typeof query === 'string' && query ? [query] : [];
}

/** The delegate says in its output that a search failed. */
function reportsError(part: WebSearchUIPart): boolean {
  return (
    part.state === 'output-available' &&
    (part.output as { status?: unknown } | undefined)?.status === 'error'
  );
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
  const found = parts.some(
    part => part.state === 'output-available' && !reportsError(part)
  );
  // Open while searching, so it can be watched, and closed once done — as
  // the reasoning is. The reader can open or close it either way.
  const [isExpanded, setIsExpanded] = useState(searching);
  useEffect(() => {
    setIsExpanded(searching);
  }, [searching]);

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
              {!found
                ? 'Could not search the web'
                : parts.length === 1
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
                // Failed, or stopped before it finished: the delegate says
                // so in its output, a stopped call in its state.
                const failed =
                  part.state === 'output-error' || reportsError(part);
                const verb = running
                  ? 'Searching'
                  : failed
                    ? 'Could not search'
                    : 'Searched';
                const queries = queriesOf(part);
                return (queries.length ? queries : [undefined]).map(
                  (query, queryIndex) => (
                    <li
                      key={`${part.toolCallId ?? index}-${queryIndex}`}
                      className="truncate"
                    >
                      {query ? `${verb} “${query}”` : verb}
                      {running && '…'}
                    </li>
                  )
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

/** How many sites' icons the closed list shows, one over the next. */
const ICONS_STACKED = 4;

/** The pill the list opens from, and each page in it, alike. */
const PILL =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground';

/**
 * The pages a reply drew on, under it: closed, the icons of the first few
 * sites and how many pages there are; opened, each page as a pill — its
 * site's icon and its title — as many to a line as fit.
 */
export function MessageSources({ sources }: { sources: WebSource[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (sources.length === 0) return null;

  const stacked = [...new Set(sources.map(siteOf))].slice(0, ICONS_STACKED);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={PILL}
      >
        <span className="flex -space-x-1.5">
          {/* The first on top, each over the one after it. */}
          {stacked.map((site, index) => (
            <SiteIcon
              key={site}
              site={site}
              style={{ zIndex: stacked.length - index }}
              className="relative size-3.5 bg-muted"
            />
          ))}
        </span>
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
        <ChevronDown
          className={cn('size-3.5 transition-transform', {
            'rotate-180': isExpanded
          })}
        />
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.ul
            key="sources"
            className="mt-2 flex flex-wrap gap-1.5 overflow-hidden"
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            variants={variants}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            {sources.map(source => (
              <li key={source.url} className="min-w-0">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${source.title}\n${source.url}`}
                  className={cn(PILL, 'max-w-64')}
                >
                  <SiteIcon site={siteOf(source)} className="size-3.5" />
                  <span className="truncate">{source.title}</span>
                </a>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A site's icon, round, as Google's icon service has it — a globe where
 *  it has none, or cannot be reached. */
function SiteIcon({
  site,
  className,
  style
}: {
  site: string;
  className: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Globe
        style={style}
        className={cn('shrink-0 rounded-full text-muted-foreground', className)}
      />
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=32`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={style}
      className={cn('shrink-0 rounded-full', className)}
    />
  );
}

/** The site a page is on: its host — or its title, where the address is a
 *  search's redirect and the title names the site. */
function siteOf(source: WebSource): string {
  const title = source.title.trim();
  return /^[\w.-]+\.[a-z]{2,}$/i.test(title)
    ? title.replace(/^www\./, '')
    : hostOf(source.url) || title;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
