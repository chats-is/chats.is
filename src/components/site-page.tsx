import { MessageMarkdown } from '@/components/message-markdown';

/** One of the site's own pages — about, terms, privacy — as the operator
 *  wrote it in Markdown. */
export function SitePage({ markdown }: { markdown: string }) {
  return (
    // Started where every page of the site starts, and kept to a width that
    // reads well.
    <div className="mx-auto max-w-6xl px-4 py-12">
      <article className="max-w-3xl">
        <MessageMarkdown content={markdown} />
      </article>
    </div>
  );
}
