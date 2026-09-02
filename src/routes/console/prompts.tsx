import { createFileRoute } from '@tanstack/react-router';

import Prompts from '@/components/console/prompts';

export const Route = createFileRoute('/console/prompts')({
  head: () => ({ meta: [{ title: 'Prompts' }] }),
  component: Prompts
});
