import { createFileRoute } from '@tanstack/react-router';

import { ModelsSettings } from '@/components/console/settings/models';

export const Route = createFileRoute('/console/settings/models')({
  head: () => ({ meta: [{ title: 'Models Settings' }] }),
  component: ModelsSettings
});
