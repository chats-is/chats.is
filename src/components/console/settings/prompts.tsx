import { SettingsForm, SettingsLoading, useSettingsForm } from './shared';

const KEYS = ['default.chat.systemPrompt'] as const;

export function PromptsSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);

  if (isLoading) return <SettingsLoading />;

  return (
    <SettingsForm form={form}>
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Default Prompts</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <form.AppField name="default.chat.systemPrompt">
            {field => (
              <field.TextareaField
                label="Default Chat System Prompt"
                placeholder="Added to every chat, after the app's own system prompt and before the model's own."
                rows={4}
              />
            )}
          </form.AppField>
        </div>
      </div>
    </SettingsForm>
  );
}
