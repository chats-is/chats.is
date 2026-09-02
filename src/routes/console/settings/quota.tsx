import { createFileRoute } from '@tanstack/react-router';

import { QuotaSettings } from '@/components/console/settings/quota';

export const Route = createFileRoute('/console/settings/quota')({
  head: () => ({ meta: [{ title: 'Quota Settings' }] }),
  component: QuotaSettings
});
