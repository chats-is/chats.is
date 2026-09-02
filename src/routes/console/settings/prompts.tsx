import { createFileRoute } from '@tanstack/react-router';

import { PromptsSettings } from '@/components/console/settings/prompts';

export const Route = createFileRoute('/console/settings/prompts')({
  head: () => ({ meta: [{ title: 'Prompts Settings' }] }),
  component: PromptsSettings
});
