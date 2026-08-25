'use client';

import { api } from '@/trpc/react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { SettingsLoading, SettingsSaveBar, useSettingsForm } from './shared';

const KEYS = [
  'default.chat.modelId',
  'default.image.modelId',
  'default.image.editModelId',
  'default.video.modelId',
  'default.video.imageModelId',
  'default.tts.modelId',
  'default.stt.modelId',
  'speech.enabled',
  'title.modelId'
] as const;

type ModelOption = { id: string; modelId: string; name: string };

/** One "pick a default model" select — the same shape repeated nine times. */
function ModelSelect({
  label,
  options,
  value,
  onChange,
  disabled
}: {
  label: string;
  options: ModelOption[] | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const isEmpty = !options?.length;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        disabled={isEmpty || disabled}
        // Undefined (not '') so the placeholder shows rather than a blank
        // value — including when the saved id names a model that has since
        // been deleted or disabled, which Radix would otherwise render as an
        // empty trigger with no hint that anything is set.
        value={
          options?.some(option => option.modelId === value) ? value : undefined
        }
        onValueChange={onChange}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={isEmpty ? 'No available models' : 'Select model'}
          />
        </SelectTrigger>
        <SelectContent>
          {options?.map(option => (
            <SelectItem key={option.id} value={option.modelId}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ModelsSettings() {
  const { formData, handleChange, save, hasChanges, isLoading, isSaving } =
    useSettingsForm(KEYS);
  const { data: models } = api.model.list.useQuery();

  const chatModels = models?.filter(
    m => m.capability === 'chat' && m.isEnabled
  );
  const imageModels = models?.filter(
    m => m.capability === 'image' && m.isEnabled
  );
  // Editing is a per-model capability; offering a model that lacks it as the
  // default editor would configure a tool that always refuses.
  const imageEditModels = imageModels?.filter(m => m.supportsEdit);
  const videoModels = models?.filter(
    m => m.capability === 'video' && m.isEnabled
  );
  const videoImageModels = videoModels?.filter(m => m.supportsEdit);
  const speechModels = models?.filter(
    m => m.capability === 'audio' && m.isEnabled && !m.supportsTranscription
  );
  const transcriptionModels = models?.filter(
    m => m.capability === 'audio' && m.isEnabled && m.supportsTranscription
  );

  const speechEnabled = formData['speech.enabled'] === 'true';
  if (isLoading) return <SettingsLoading />;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Default Models</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ModelSelect
            label="Default Chat Model"
            options={chatModels}
            value={formData['default.chat.modelId']}
            onChange={value => handleChange('default.chat.modelId', value)}
            disabled={isSaving}
          />
          <ModelSelect
            label="Default Image Model"
            options={imageModels}
            value={formData['default.image.modelId']}
            onChange={value => handleChange('default.image.modelId', value)}
            disabled={isSaving}
          />
          <ModelSelect
            label="Default Image Edit Model"
            options={imageEditModels}
            value={formData['default.image.editModelId']}
            onChange={value => handleChange('default.image.editModelId', value)}
            disabled={isSaving}
          />
          <ModelSelect
            label="Default Video Model"
            options={videoModels}
            value={formData['default.video.modelId']}
            onChange={value => handleChange('default.video.modelId', value)}
            disabled={isSaving}
          />
          <ModelSelect
            label="Default Image-to-Video Model"
            options={videoImageModels}
            value={formData['default.video.imageModelId']}
            onChange={value =>
              handleChange('default.video.imageModelId', value)
            }
            disabled={isSaving}
          />
          <ModelSelect
            label="Default TTS Model"
            options={speechModels}
            value={formData['default.tts.modelId']}
            onChange={value => handleChange('default.tts.modelId', value)}
            disabled={isSaving}
          />
          <ModelSelect
            label="Default Transcription Model"
            options={transcriptionModels}
            value={formData['default.stt.modelId']}
            onChange={value => handleChange('default.stt.modelId', value)}
            disabled={isSaving}
          />
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Text-to-Speech Reading</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Whether messages can be read aloud. Which model and voice does it is
          the Default TTS Model above — reading a message aloud and generating
          speech in a reply are the same job.
        </p>
        <div className="space-y-2">
          <Label>Enable Speech</Label>
          <div className="flex items-center space-x-2">
            <Switch
              checked={speechEnabled}
              onCheckedChange={checked =>
                handleChange('speech.enabled', String(checked))
              }
              disabled={isSaving}
            />
            <Label className="font-normal text-muted-foreground">
              {speechEnabled ? 'Enabled' : 'Disabled'}
            </Label>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Title Generation</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ModelSelect
            label="Title Generation Model"
            options={chatModels}
            value={formData['title.modelId']}
            onChange={value => handleChange('title.modelId', value)}
            disabled={isSaving}
          />
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
