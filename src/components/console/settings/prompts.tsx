import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { SettingsLoading, SettingsSaveBar, useSettingsForm } from './shared';

const KEYS = ['default.chat.systemPrompt'] as const;

export function PromptsSettings() {
  const { formData, handleChange, save, hasChanges, isLoading, isSaving } =
    useSettingsForm(KEYS);

  if (isLoading) return <SettingsLoading />;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Default Prompts</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Default Chat System Prompt</Label>
            <Textarea
              disabled={isSaving}
              value={formData['default.chat.systemPrompt'] || ''}
              onChange={e =>
                handleChange('default.chat.systemPrompt', e.target.value)
              }
              placeholder="Fallback system prompt for chat models that don't define their own. Supports {provider}, {modelId}, {date}."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              The default system prompt used for new chat conversations.
            </p>
          </div>
        </div>
      </div>

      <SettingsSaveBar
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSave={save}
      />
    </div>
  );
}
