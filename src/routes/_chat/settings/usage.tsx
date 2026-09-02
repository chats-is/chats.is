import { createFileRoute } from '@tanstack/react-router';

import { SettingsUsage } from '@/components/settings-usage';

export const Route = createFileRoute('/_chat/settings/usage')({
  head: () => ({ meta: [{ title: 'Usage' }] }),
  component: SettingsUsage
});
