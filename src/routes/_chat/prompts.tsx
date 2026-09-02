import { createFileRoute } from '@tanstack/react-router';

import { PromptsView } from '@/components/prompts-view';

export const Route = createFileRoute('/_chat/prompts')({
  head: () => ({ meta: [{ title: 'Prompts' }] }),
  component: PromptsView
});
