import { useQuery } from '@tanstack/react-query';

import { modelQueries } from '@/server/fn/model';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import {
  SettingsForm,
  SettingsLoading,
  useSettingsForm,
  type SettingsFormApi
} from './shared';

const KEYS = [
  'default.chat.modelId',
  'default.image.modelId',
  'default.image.editModelId',
  'default.video.modelId',
  'default.video.imageModelId',
  'default.video.editModelId',
  'default.tts.modelId',
  'default.stt.modelId',
  'speech.enabled',
  'title.modelId'
] as const;

type ModelOption = { id: string; modelId: string; name: string };

/**
 * One "pick a default model" select — the same shape repeated nine times.
 *
 * A saved id that no longer names an available model shows the placeholder
 * rather than a blank trigger; `SelectField` does that for any select whose
 * value is not among its options.
 */
function ModelSelect({
  form,
  name,
  label,
  options
}: {
  form: SettingsFormApi;
  name: string;
  label: string;
  options: ModelOption[] | undefined;
}) {
  const isEmpty = !options?.length;

  return (
    <form.AppField name={name}>
      {field => (
        <field.SelectField
          label={label}
          disabled={isEmpty}
          placeholder={isEmpty ? 'No available models' : 'Select model'}
          options={(options ?? []).map(option => ({
            value: option.modelId,
            label: option.name
          }))}
        />
      )}
    </form.AppField>
  );
}

export function ModelsSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);
  const { data: models } = useQuery(modelQueries.list());

  const chatModels = models?.filter(
    m => m.capability === 'chat' && m.isEnabled
  );
  const imageModels = models?.filter(
    m => m.capability === 'image' && m.isEnabled
  );
  // Editing is a per-model capability; offering a model that lacks it as the
  // default editor would configure a tool that always refuses.
  const imageEditModels = imageModels?.filter(m => m.supportsImageEdit);
  const videoModels = models?.filter(
    m => m.capability === 'video' && m.isEnabled
  );
  const videoImageModels = videoModels?.filter(m => m.supportsImageToVideo);
  const videoEditModels = videoModels?.filter(m => m.supportsVideoEdit);
  const speechModels = models?.filter(
    m => m.capability === 'audio' && m.isEnabled && !m.supportsTranscription
  );
  const transcriptionModels = models?.filter(
    m => m.capability === 'audio' && m.isEnabled && m.supportsTranscription
  );

  if (isLoading) return <SettingsLoading />;

  return (
    <SettingsForm form={form}>
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Default Models</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ModelSelect
            form={form}
            name="default.chat.modelId"
            label="Default Chat Model"
            options={chatModels}
          />
          <ModelSelect
            form={form}
            name="default.image.modelId"
            label="Default Image Model"
            options={imageModels}
          />
          <ModelSelect
            form={form}
            name="default.image.editModelId"
            label="Default Image Edit Model"
            options={imageEditModels}
          />
          <ModelSelect
            form={form}
            name="default.video.modelId"
            label="Default Video Model"
            options={videoModels}
          />
          <ModelSelect
            form={form}
            name="default.video.imageModelId"
            label="Default Image-to-Video Model"
            options={videoImageModels}
          />
          <ModelSelect
            form={form}
            name="default.video.editModelId"
            label="Default Video Edit Model"
            options={videoEditModels}
          />
          <ModelSelect
            form={form}
            name="default.tts.modelId"
            label="Default TTS Model"
            options={speechModels}
          />
          <ModelSelect
            form={form}
            name="default.stt.modelId"
            label="Default Transcription Model"
            options={transcriptionModels}
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
          {/* Settings are stored as text, so this switch is over "true"/"false"
              rather than a boolean, and binds by hand. */}
          <form.Field name="speech.enabled">
            {field => {
              const enabled = field.state.value === 'true';
              return (
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={enabled}
                    onCheckedChange={checked =>
                      field.handleChange(String(checked))
                    }
                  />
                  <Label className="font-normal text-muted-foreground">
                    {enabled ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>
              );
            }}
          </form.Field>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Title Generation</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ModelSelect
            form={form}
            name="title.modelId"
            label="Title Generation Model"
            options={chatModels}
          />
        </div>
      </div>
    </SettingsForm>
  );
}
