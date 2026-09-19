import {
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_NAME,
  DEFAULT_APP_SUBTITLE
} from '@/lib/constant';

import { SettingsForm, SettingsLoading, useSettingsForm } from './shared';

const KEYS = [
  'app.name',
  'app.subtitle',
  'app.description',
  'default.chat.systemPrompt'
] as const;

/**
 * What this installation calls itself, and what it says to every model.
 *
 * Both are written rather than chosen, which is why they share a page and why
 * neither is a row in a list: a name and a prompt are typed into, and a field
 * wide enough to type into is the whole point.
 */
export function GeneralSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);

  if (isLoading) return <SettingsLoading />;

  return (
    <SettingsForm form={form}>
      <div className="overflow-hidden rounded-lg border">
        <h2 className="border-b bg-muted px-4 py-3 font-semibold">
          Application
        </h2>
        <div className="grid gap-4 p-4 md:grid-cols-2">
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
                fieldClassName="md:col-span-2"
              />
            )}
          </form.AppField>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <h2
          id="system-prompt-heading"
          className="border-b bg-muted px-4 py-3 font-semibold"
        >
          Default Chat System Prompt
        </h2>
        <div className="p-4">
          {/* The heading names this field, so it carries no label of its own
              rather than saying the same thing twice. */}
          <form.AppField name="default.chat.systemPrompt">
            {field => (
              <field.TextareaField
                aria-labelledby="system-prompt-heading"
                placeholder="Added to every chat, after the app's own system prompt and before the model's own."
                rows={12}
              />
            )}
          </form.AppField>
        </div>
      </div>
    </SettingsForm>
  );
}
