import {
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_NAME,
  DEFAULT_APP_SUBTITLE
} from '@/lib/constant';

import { SettingsForm, SettingsLoading, useSettingsForm } from './shared';

const KEYS = ['app.name', 'app.subtitle', 'app.description'] as const;

export function GeneralSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);

  if (isLoading) return <SettingsLoading />;

  return (
    <SettingsForm form={form}>
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Application</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <form.AppField name="app.name">
            {field => (
              <field.TextField
                label="App Name"
                // The placeholder is what an empty field falls back to, so it
                // reads from the same constant rather than restating it.
                placeholder={DEFAULT_APP_NAME}
              />
            )}
          </form.AppField>
          <form.AppField name="app.subtitle">
            {field => (
              <field.TextField
                label="App Subtitle"
                placeholder={DEFAULT_APP_SUBTITLE}
              />
            )}
          </form.AppField>
          <form.AppField name="app.description">
            {field => (
              <field.TextareaField
                label="App Description"
                placeholder={DEFAULT_APP_DESCRIPTION}
                rows={3}
                fieldClassName="col-span-2"
              />
            )}
          </form.AppField>
        </div>
      </div>
    </SettingsForm>
  );
}
