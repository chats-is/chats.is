import React from 'react'
import remarkGfm from 'remark-gfm'

import { CodeBlock } from '@/components/codeblock'
import { MemoizedReactMarkdown } from '@/components/markdown'

interface MessageMarkdownProps {
  content: string
}

export function MessageMarkdown({ content }: MessageMarkdownProps) {
  // Typography draws curly quotes around blockquote paragraphs, which doubles
  // up whenever the quoted text carries its own — a transcript rendered as
  // `> "what was said"` came out with two pairs. The indent already says it is
  // a quotation.
  return (
    <div className="prose wrap-break-word dark:prose-invert prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0 prose-hr:my-3 [&_blockquote_p:first-of-type]:before:content-none [&_blockquote_p:last-of-type]:after:content-none [&_li_p]:my-0!">
      <MemoizedReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const childArray = React.Children.toArray(children)
            const firstChild = childArray[0] as React.ReactElement<any>
            const firstChildAsString = React.isValidElement(firstChild)
              ? (firstChild as React.ReactElement<any>).props.children
              : firstChild

            if (firstChildAsString === '▍') {
              return (
                <span className="mt-1 animate-pulse cursor-default">▍</span>
              )
            }

            if (typeof firstChildAsString === 'string') {
              childArray[0] = firstChildAsString.replace('`▍`', '▍')
            }

            const languageClass = (className || '')
              .split(/\s+/)
              .find((token) => token.startsWith('language-'))
            const language = languageClass?.slice('language-'.length) || ''

            if (
              typeof firstChildAsString === 'string' &&
              !firstChildAsString.includes('\n')
            ) {
              return (
                <code className={className} {...props}>
                  {childArray}
                </code>
              )
            }

            return (
              <CodeBlock
                language={language}
                value={String(childArray).replace(/\n$/, '')}
                showLineNumbers={false}
                {...props}
              />
            )
          },
        }}
      >
        {content}
      </MemoizedReactMarkdown>
    </div>
  )
}
