import { createFileRoute } from '@tanstack/react-router';

import { GeneralSettings } from '@/components/console/settings/general';

export const Route = createFileRoute('/console/settings/general')({
  head: () => ({ meta: [{ title: 'General Settings' }] }),
  component: GeneralSettings
});
