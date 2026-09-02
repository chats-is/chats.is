import { createFileRoute } from '@tanstack/react-router';

import { UserPrompt } from '@/components/user-prompt';

export const Route = createFileRoute('/_chat/settings/prompts')({
  head: () => ({ meta: [{ title: 'Prompt Settings' }] }),
  component: UserPrompt
});
