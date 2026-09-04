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
              <field.TextField label="App Name" placeholder="Chats.is" />
            )}
          </form.AppField>
          <form.AppField name="app.subtitle">
            {field => (
              <field.TextField label="App Subtitle" placeholder="AI Chatbot" />
            )}
          </form.AppField>
          <form.AppField name="app.description">
            {field => (
              <field.TextareaField
                label="App Description"
                placeholder="Your AI assistant..."
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
