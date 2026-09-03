import { createFileRoute } from '@tanstack/react-router';

import { pageTitle } from '@/lib/head';
import { SettingsGeneral } from '@/components/settings-general';
import { SettingsProfile } from '@/components/settings-profile';

export const Route = createFileRoute('/_chat/settings/general')({
  head: ({ matches }) => ({ meta: [{ title: pageTitle(matches, 'General Settings') }] }),
  component: GeneralSettings
});

function GeneralSettings() {
  return (
    <section className="w-full space-y-6">
      <SettingsProfile />
      <SettingsGeneral />
    </section>
  );
}
