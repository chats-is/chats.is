import { createFileRoute } from '@tanstack/react-router';

import { SharedLinks } from '@/components/shared-links';

export const Route = createFileRoute('/_chat/settings/shared-links')({
  head: () => ({ meta: [{ title: 'Shared Links Settings' }] }),
  component: SharedLinks
});
