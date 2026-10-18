import { useState } from 'react';
import { useStore } from '@tanstack/react-form';
import { ExternalLink } from 'lucide-react';

import { type SitePage } from '@/types/settings';
import { SITE_PAGES } from '@/lib/constant';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MessageMarkdown } from '@/components/message-markdown';

import {
  SettingsForm,
  useSettingsForm,
  type SettingsFormApi
} from './settings-form';
import { readPath } from './settings-values';

/** What each of the site's own pages is called here. */
const PAGE_LABELS: Record<SitePage, string> = {
  about: 'About',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy'
};

/** Each page is a setting of its own, `pages.<page>`. */
const keyOf = (page: SitePage) => `pages.${page}`;
const KEYS = SITE_PAGES.map(keyOf);

/**
 * The site's own pages, one at a time: chosen by a tab, written in Markdown
 * on the left and shown on the right as the site will show it. Edits to
 * every page are kept while moving between them, and saved together.
 */
export function ConsolePages() {
  const { form, isHeld } = useSettingsForm(KEYS);
  const [page, setPage] = useState<SitePage>(SITE_PAGES[0]);

  return (
    <SettingsForm form={form} isHeld={isHeld}>
      <Tabs
        value={page}
        onValueChange={value => setPage(value as SitePage)}
        className="items-center"
      >
        <TabsList>
          {SITE_PAGES.map(p => (
            <TabsTrigger key={p} value={p}>
              {PAGE_LABELS[p]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <PageEditor key={page} form={form} page={page} />
    </SettingsForm>
  );
}

/** One page: its Markdown, what the site will show, and the way to it. */
function PageEditor({ form, page }: { form: SettingsFormApi; page: SitePage }) {
  const key = keyOf(page);
  const markdown = useStore(form.store, state => readPath(state.values, key));

  return (
    <div className="space-y-3">
      <div className="flex justify-end text-sm">
        <a
          href={`/${page}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          View page
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form.AppField name={key}>
          {field => (
            <field.TextareaField
              aria-label={`${PAGE_LABELS[page]} in Markdown`}
              placeholder="Write the page in Markdown…"
              className="field-sizing-fixed h-[65vh] resize-none font-mono"
            />
          )}
        </form.AppField>

        <div className="h-[65vh] overflow-y-auto rounded-md border px-6 py-4">
          <MessageMarkdown content={markdown} />
        </div>
      </div>
    </div>
  );
}
