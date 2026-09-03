import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { PromptsSettings } from '@/components/console/settings/prompts';

export const Route = createFileRoute('/console/settings/prompts')({
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'Prompts Settings') }] }),
  component: PromptsSettings
});
