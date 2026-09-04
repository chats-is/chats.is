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
                placeholder="Fallback system prompt for chat models that don't define their own. Supports {provider}, {modelId}, {date}."
                rows={4}
                hint="The default system prompt used for new chat conversations."
              />
            )}
          </form.AppField>
        </div>
      </div>
    </SettingsForm>
  );
}
