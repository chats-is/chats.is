import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { GeneralSettings } from '@/components/console/settings/general';

export const Route = createFileRoute('/console/settings/general')({
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'General Settings') }] }),
  component: GeneralSettings
});
