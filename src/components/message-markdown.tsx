import { useMemo } from 'react';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { type MermaidConfig } from 'mermaid';
import { useTheme } from 'next-themes';
import remarkBreaks from 'remark-breaks';
import {
  defaultComponents,
  defaultRemarkPlugins,
  Streamdown,
  type CodeHighlighterPlugin,
  type Components,
  type DiagramPlugin
} from 'streamdown';

import { cn } from '@/lib/utils';

interface MessageMarkdownProps {
  content: string;
  /** Still arriving: formatting not yet closed is drawn as it will be, not
   *  as the marks typed so far. */
  streaming?: boolean;
  className?: string;
}

/**
 * Code coloured by Shiki, loaded the first time a reply has a code block to
 * colour: imported up front, it and Mermaid put 1.4 MB more on every page
 * that shows a chat. Until it arrives a block is drawn plain, and Streamdown
 * is told the colours when they are ready.
 */
// The themes @streamdown/code colours with by default — one array, since a
// code block colours itself again whenever it is handed a new one.
const SHIKI_THEMES: ReturnType<CodeHighlighterPlugin['getThemes']> = [
  'github-light',
  'github-dark'
];
let shiki: CodeHighlighterPlugin | undefined;
let shikiLoading: Promise<CodeHighlighterPlugin> | undefined;
const code: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getThemes: () => SHIKI_THEMES,
  getSupportedLanguages: () => shiki?.getSupportedLanguages() ?? [],
  supportsLanguage: language => shiki?.supportsLanguage(language) ?? true,
  highlight: (options, callback) => {
    if (shiki) return shiki.highlight(options, callback);
    shikiLoading ??= import('@streamdown/code').then(
      module => (shiki = module.code)
    );
    void shikiLoading.then(plugin => {
      const result = plugin.highlight(options, callback);
      if (result) callback?.(result);
    });
    return null;
  }
};

/** How a diagram is drawn unless a reply's renderer says otherwise. */
const MERMAID_DEFAULTS: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true
};

/**
 * Diagrams drawn by the app's own Mermaid — the one an artifact's preview
 * draws with — loaded the first time a reply has a diagram to draw, which is
 * waited for anyway. Mermaid keeps one set of settings for the page, so each
 * diagram sets its own (its theme follows the page's) just before it is
 * drawn.
 */
const mermaid: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid: config => {
    // Streamdown types the settings loosely, Mermaid by its own types; they
    // are the same settings.
    let settings = { ...MERMAID_DEFAULTS, ...config } as MermaidConfig;
    return {
      initialize: next => {
        settings = { ...MERMAID_DEFAULTS, ...config, ...next } as MermaidConfig;
      },
      render: async (id, source) => {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize(settings);
        return mermaid.render(id, source);
      }
    };
  }
};

// Chinese emphasis beside its own punctuation, highlighted code, KaTeX
// mathematics, and Mermaid diagrams.
const PLUGINS = { cjk, code, math, mermaid };

const Link = defaultComponents.a;

// Streamdown's settings are handed down to every block, and a new object
// draws them all again: these stay the same objects from one streamed
// character to the next.

// A link opens in a new tab, as the reader asked it to; a dialog asking first
// would stand between them and every source.
const LINK_SAFETY = { enabled: false };

// A diagram is drawn to fit; its zoom buttons sat over its first node. Full
// screen is still there to look closer.
const CONTROLS = { mermaid: { panZoom: false } };

// A line ended is a line ended, as the model meant it: an address, its hours
// and a phone number, each on a line of its own, read as one line otherwise.
// Streamdown's own plugins first, which a list given here replaces.
const REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkBreaks];

/**
 * Lists and quotations, drawn as prose is: a list's markers hang outside its
 * text, so a wrapped line lines up with the line above and not with the
 * number; and a paragraph inside an item or a quotation stays a paragraph of
 * its own. Streamdown's own run every paragraph of an item into one line.
 */
const COMPONENTS: Components = {
  ol: ({ node: _node, className, ...props }) => (
    <ol
      className={cn('list-decimal pl-6 whitespace-normal', className)}
      {...props}
    />
  ),
  ul: ({ node: _node, className, ...props }) => (
    <ul
      className={cn('list-disc pl-6 whitespace-normal', className)}
      {...props}
    />
  ),
  li: ({ node: _node, className, ...props }) => (
    <li
      className={cn(
        'py-1 [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0',
        className
      )}
      {...props}
    />
  ),
  blockquote: ({ node: _node, className, ...props }) => (
    <blockquote
      className={cn(
        'my-4 space-y-2 border-l-4 border-muted-foreground/30 pl-4 text-muted-foreground italic',
        className
      )}
      {...props}
    />
  ),
  // Streamdown opens every link in a new tab, and a footnote's — a jump
  // within the reply, to its note and back — opened the reply again in one.
  a: ({ href, ...props }) =>
    href?.startsWith('#') ? (
      <Link href={href} {...props} target="_self" />
    ) : (
      <Link href={href} {...props} />
    )
};

const CODE_SPAN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;

/**
 * Mathematics in the one form the renderer reads as such, `$$…$$` — inline
 * within a line, a block on lines of its own.
 *
 * A single dollar is left as text by the renderer, so that a price is not
 * read as the start of a formula: "上涨约$33.90" after "$4,138.40" made one
 * formula of everything between them. Models still write formulas both as
 * `\(x\)` and as `$x$`, so both are rewritten here — a pair of single dollars
 * only where Pandoc would take it for mathematics: the opening one followed by
 * something other than a space, the closing one preceded by something other
 * than a space and not followed by a digit, both in the same paragraph. A
 * price fails that ("$5 and $10", "$5-$10") and stays a price.
 *
 * A formula alone on its line, as `$$…$$` or `\[…\]`, is a display: the
 * renderer takes `$$…$$` on one line for an inline formula, so it is spread
 * over three, which it draws as a block of its own.
 *
 * Fenced and inline code are left alone: `\(` inside a code sample is code,
 * not mathematics, and rewriting it would corrupt what the user asked to
 * see verbatim.
 */
export function normalizeMath(content: string): string {
  const parts = content.split(CODE_SPAN);
  return parts
    .map((part, index) =>
      // The split keeps the delimiters, and every captured group lands on an
      // odd index — those are the code spans, passed through untouched.
      index % 2 === 1
        ? part
        : dollarMath(
            displayMath(
              part.replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `$$${body}$$`),
              // After code, its first line goes on from that code's line;
              // before code, its last goes on into it.
              { first: index === 0, last: index === parts.length - 1 }
            ).replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$$${body}$$`)
          )
    )
    .join('');
}

/** A line that is a formula alone — within a quotation, or indented, as it
 *  may be — and nothing else. */
const DISPLAY_LINE =
  /^((?:[ \t]*>)*[ \t]*)\$\$(?!\$)([^\n]*?\S[^\n]*?)\$\$[ \t]*$/;

/** The one-line formulas of some prose that stand alone on their lines,
 *  spread over three. A line that runs on from code, or into it, is not
 *  alone. */
function displayMath(
  text: string,
  whole: { first: boolean; last: boolean }
): string {
  const lines = text.split('\n');
  return lines
    .map((line, index) => {
      if (index === 0 && !whole.first) return line;
      if (index === lines.length - 1 && !whole.last) return line;
      const match = DISPLAY_LINE.exec(line);
      if (!match || match[2].includes('$$')) return line;
      const [, prefix, body] = match;
      return `${prefix}$$\n${prefix}${body.trim()}\n${prefix}$$`;
    })
    .join('\n');
}

/** The pairs of single dollars in some prose that are mathematics, made
 *  double; every other dollar left as it is. */
function dollarMath(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      out += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char !== '$') {
      out += char;
      index += 1;
      continue;
    }
    // Already double: through to its closing pair, untouched.
    if (text[index + 1] === '$') {
      const close = text.indexOf('$$', index + 2);
      const end = close === -1 ? index + 2 : close + 2;
      out += text.slice(index, end);
      index = end;
      continue;
    }
    const close = closingDollar(text, index);
    if (close === -1) {
      out += char;
      index += 1;
      continue;
    }
    out += `$$${text.slice(index + 1, close)}$$`;
    index = close + 1;
  }
  return out;
}

/** Where the formula a single dollar opens is closed — the next single
 *  dollar in the paragraph, if it may close one — or -1. */
function closingDollar(text: string, open: number): number {
  if (!/\S/.test(text[open + 1] ?? ' ')) return -1;
  for (let index = open + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '\n' && text[index + 1] === '\n') return -1;
    if (char !== '$') continue;
    if (text[index + 1] === '$') return -1;
    const closes =
      /\S/.test(text[index - 1]) && !/\d/.test(text[index + 1] ?? '');
    return closes ? index : -1;
  }
  return -1;
}

export function MessageMarkdown({
  content,
  streaming = false,
  className
}: MessageMarkdownProps) {
  // Mermaid colours a diagram itself, and its light theme left an arrow's
  // label dark on the dark page. Its colour theme, as an artifact's preview
  // draws it, in the page's light or dark.
  const { resolvedTheme } = useTheme();
  const mermaidOptions = useMemo(
    () => ({
      config: {
        theme: resolvedTheme === 'dark' ? 'redux-dark-color' : 'redux-color'
      }
    }),
    [resolvedTheme]
  );
  return (
    <Streamdown
      className={cn('wrap-break-word', className)}
      plugins={PLUGINS}
      components={COMPONENTS}
      isAnimating={streaming}
      remarkPlugins={REMARK_PLUGINS}
      linkSafety={LINK_SAFETY}
      lineNumbers={false}
      controls={CONTROLS}
      mermaid={mermaidOptions}
      // Shown whole, as the rest of the reply is: a scroll inside the
      // thread's own scroll is one too many.
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
    >
      {normalizeMath(content)}
    </Streamdown>
  );
}
