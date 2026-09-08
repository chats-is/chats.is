import React from 'react';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { CodeBlock } from '@/components/codeblock';
import { MemoizedReactMarkdown } from '@/components/markdown';

interface MessageMarkdownProps {
  content: string;
}

/**
 * Rewrite LaTeX's own delimiters into the ones `remark-math` reads.
 *
 * Models write mathematics both ways — `\(x\)` and `$x$` — often in the same
 * answer, and remark-math only knows the dollar form. Without this the other
 * half arrives on screen as its own source code.
 *
 * Fenced and inline code are left alone: `\(` inside a code sample is code,
 * not mathematics, and rewriting it would corrupt what the user asked to
 * see verbatim.
 */
const CODE_SPAN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;

export function normalizeMath(content: string): string {
  return content
    .split(CODE_SPAN)
    .map((part, index) =>
      // The split keeps the delimiters, and every captured group lands on an
      // odd index — those are the code spans, passed through untouched.
      index % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, body) => `$$${body}$$`)
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, body) => `$${body}$`)
    )
    .join('');
}

export function MessageMarkdown({ content }: MessageMarkdownProps) {
  // Typography draws curly quotes around blockquote paragraphs, which doubles
  // up whenever the quoted text carries its own — a transcript rendered as
  // `> "what was said"` came out with two pairs. The indent already says it is
  // a quotation.
  return (
    <div className="prose wrap-break-word dark:prose-invert prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0 prose-hr:my-3 [&_blockquote_p:first-of-type]:before:content-none [&_blockquote_p:last-of-type]:after:content-none [&_li_p]:my-0!">
      <MemoizedReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const childArray = React.Children.toArray(children);
            const firstChild = childArray[0] as React.ReactElement<any>;
            const firstChildAsString = React.isValidElement(firstChild)
              ? (firstChild as React.ReactElement<any>).props.children
              : firstChild;

            if (firstChildAsString === '▍') {
              return (
                <span className="mt-1 animate-pulse cursor-default">▍</span>
              );
            }

            if (typeof firstChildAsString === 'string') {
              childArray[0] = firstChildAsString.replace('`▍`', '▍');
            }

            const languageClass = (className || '')
              .split(/\s+/)
              .find(token => token.startsWith('language-'));
            const language = languageClass?.slice('language-'.length) || '';

            if (
              typeof firstChildAsString === 'string' &&
              !firstChildAsString.includes('\n')
            ) {
              return (
                <code className={className} {...props}>
                  {childArray}
                </code>
              );
            }

            return (
              <CodeBlock
                language={language}
                value={String(childArray).replace(/\n$/, '')}
                showLineNumbers={false}
                {...props}
              />
            );
          }
        }}
      >
        {normalizeMath(content)}
      </MemoizedReactMarkdown>
    </div>
  );
}
