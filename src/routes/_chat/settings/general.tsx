import { createFileRoute } from '@tanstack/react-router';

import { SettingsGeneral } from '@/components/settings-general';
import { SettingsProfile } from '@/components/settings-profile';

export const Route = createFileRoute('/_chat/settings/general')({
  head: () => ({ meta: [{ title: 'General Settings' }] }),
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
