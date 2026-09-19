import { useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import {
  AudioLines,
  Clapperboard,
  Film,
  Gauge,
  Image,
  MessageSquare,
  Mic,
  PenLine,
  Play,
  Type,
  Video,
  type LucideIcon
} from 'lucide-react';

import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { SettingsList, SettingsRow, type RowState } from './list';
import { SettingsForm, SettingsLoading, useSettingsForm } from './shared';
import { readPath } from './values';

/**
 * What this installation falls back on when nothing else says.
 *
 * Nine of these settings ask the same question — when the app has to do one
 * job, which model does it — so they are a list rather than a grid of selects,
 * and each row says what the job is. The two that are not model picks keep
 * lists of their own: neither hangs off a model, and drawing them beside one
 * would say that they do.
 */

/** What a row needs of a model to judge it. Structural, because the select
 *  query hands back whole rows and they need no narrowing to be read. */
type ModelLike = {
  modelId: string;
  name: string;
  capability: string;
  isEnabled: boolean;
  supportsImageEdit?: boolean | null;
  supportsImageToVideo?: boolean | null;
  supportsVideoEdit?: boolean | null;
  supportsTranscription?: boolean | null;
};

/** One "pick a model for this job" setting. `can` is what makes a model
 *  eligible; being enabled is required of all of them and is not restated. */
type ModelRow = {
  key: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  /** What goes undone while nothing is chosen. */
  missing: string;
  can: (model: ModelLike) => boolean;
};

const MODEL_ROWS: Array<ModelRow> = [
  {
    key: 'default.chat.modelId',
    label: 'Default Chat Model',
    icon: MessageSquare,
    hint: 'Answers when a conversation names no model of its own.',
    missing: 'A conversation with no model of its own has nothing to answer it',
    can: model => model.capability === 'chat'
  },
  {
    key: 'title.modelId',
    label: 'Title Generation Model',
    icon: Type,
    hint: 'Names a conversation from its first message.',
    missing: 'Conversations keep the name they were given',
    can: model => model.capability === 'chat'
  },
  {
    key: 'default.image.modelId',
    label: 'Default Image Model',
    icon: Image,
    hint: 'Generates a picture when a conversation asks for one.',
    missing: 'Nothing generates a picture',
    can: model => model.capability === 'image'
  },
  {
    key: 'default.image.editModelId',
    label: 'Default Image Edit Model',
    icon: PenLine,
    hint: 'Edits a picture the user attached, or one the model just made.',
    missing: 'Nothing edits a picture',
    can: model => model.capability === 'image' && !!model.supportsImageEdit
  },
  {
    key: 'default.video.modelId',
    label: 'Default Video Model',
    icon: Video,
    hint: 'Generates a clip from a written prompt.',
    missing: 'Nothing generates a clip',
    can: model => model.capability === 'video'
  },
  {
    key: 'default.video.imageModelId',
    label: 'Default Image-to-Video Model',
    icon: Film,
    hint: 'Animates a still the user supplied.',
    missing: 'Nothing animates a still',
    can: model => model.capability === 'video' && !!model.supportsImageToVideo
  },
  {
    key: 'default.video.editModelId',
    label: 'Default Video Edit Model',
    icon: Clapperboard,
    hint: 'Edits an existing clip.',
    missing: 'Nothing edits a clip',
    can: model => model.capability === 'video' && !!model.supportsVideoEdit
  },
  {
    key: 'default.tts.modelId',
    label: 'Default TTS Model',
    icon: AudioLines,
    hint: 'Generates speech.',
    missing: 'Nothing generates speech',
    can: model => model.capability === 'audio' && !model.supportsTranscription
  },
  {
    key: 'default.stt.modelId',
    label: 'Default Transcription Model',
    icon: Mic,
    hint: 'Turns recorded audio into text.',
    missing: 'Nothing transcribes recorded audio',
    can: model => model.capability === 'audio' && !!model.supportsTranscription
  }
];

const KEYS = [
  ...MODEL_ROWS.map(row => row.key),
  'speech.enabled',
  'default.quotaId'
] as const;

/**
 * How a saved model pick stands, read off what is already there.
 *
 * A key with no value is simply unset. A key naming a model that has since
 * been turned off, deleted, or had the capability taken away still looks
 * configured from the database's side, and fails only when a user asks for
 * the thing — so it is worth saying here instead.
 */
function statusOf(
  value: unknown,
  row: ModelRow,
  models: Array<ModelLike> | undefined
): { state: RowState; flag?: string } {
  if (typeof value !== 'string' || !value) {
    return { state: 'unset', flag: row.missing };
  }
  // Nothing to check against until the list lands.
  if (!models) return { state: 'set' };

  const model = models.find(candidate => candidate.modelId === value);
  if (!model) return { state: 'stale', flag: 'That model is no longer listed' };
  if (!model.isEnabled) {
    return { state: 'stale', flag: `${model.name} is disabled` };
  }
  if (!row.can(model)) {
    return { state: 'stale', flag: `${model.name} can no longer do this` };
  }
  return { state: 'set' };
}

export function DefaultsSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);
  const { data: models } = useQuery(modelQueries.forSelect());
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());

  // The live form values, so a row settles the moment a model is picked rather
  // than waiting for a save.
  const values = useStore(form.store, state => state.values);

  if (isLoading) return <SettingsLoading />;

  const statuses = MODEL_ROWS.map(row =>
    statusOf(readPath(values, row.key), row, models)
  );
  const set = statuses.filter(status => status.state === 'set').length;
  const stale = statuses.filter(status => status.state === 'stale').length;

  const quotas = (quotaOptions ?? []).map(quota => ({
    value: quota.id,
    label: quota.name + (quota.isUnlimited ? ' (Unlimited)' : '')
  }));

  return (
    <SettingsForm form={form}>
      <SettingsList
        title="Default Models"
        aside={
          <span className="text-sm font-normal text-muted-foreground">
            {set} of {MODEL_ROWS.length} set
            {stale > 0 && (
              <>
                {' · '}
                <b className="font-medium text-amber-700 dark:text-amber-400">
                  {stale === 1
                    ? '1 names a model that is unavailable'
                    : `${stale} name models that are unavailable`}
                </b>
              </>
            )}
          </span>
        }
      >
        {MODEL_ROWS.map((row, index) => {
          const status = statuses[index];
          const options = (models ?? [])
            .filter(model => model.isEnabled && row.can(model))
            .map(model => ({ value: model.modelId, label: model.name }));

          return (
            <SettingsRow
              key={row.key}
              icon={row.icon}
              label={row.label}
              htmlFor={row.key}
              hint={row.hint}
              settingKey={row.key}
              state={status.state}
              flag={status.flag}
            >
              <form.AppField name={row.key}>
                {field => (
                  <field.SelectField
                    options={options}
                    disabled={options.length === 0}
                    placeholder={
                      options.length === 0
                        ? 'No available models'
                        : 'Select model'
                    }
                  />
                )}
              </form.AppField>
            </SettingsRow>
          );
        })}
      </SettingsList>

      <SettingsList title="Text-to-Speech Reading">
        <SettingsRow
          icon={Play}
          label="Enable Speech"
          hint="Whether messages can be read aloud. Which model and voice does it is the Default TTS Model above — reading a message aloud and generating speech in a reply are the same job."
          settingKey="speech.enabled"
        >
          {/* Settings are stored as text, so this switch is over "true"/"false"
              rather than a boolean, and binds by hand. */}
          <form.Field name="speech.enabled">
            {field => {
              const enabled = field.state.value === 'true';
              return (
                <div className="flex items-center gap-2">
                  <Switch
                    id="speech.enabled"
                    checked={enabled}
                    onCheckedChange={checked =>
                      field.handleChange(String(checked))
                    }
                  />
                  <Label
                    htmlFor="speech.enabled"
                    className="font-normal text-muted-foreground"
                  >
                    {enabled ? 'Enabled' : 'Disabled'}
                  </Label>
                </div>
              );
            }}
          </form.Field>
        </SettingsRow>
      </SettingsList>

      <SettingsList title="Default Quota">
        <SettingsRow
          icon={Gauge}
          label="Default Quota"
          htmlFor="default.quotaId"
          hint="Fallback quota for users without a plan."
          settingKey="default.quotaId"
        >
          <form.AppField name="default.quotaId">
            {field => (
              <field.SelectField
                options={quotas}
                disabled={quotas.length === 0}
                placeholder={
                  quotas.length === 0 ? 'No quotas available' : 'Select a quota'
                }
              />
            )}
          </form.AppField>
        </SettingsRow>
      </SettingsList>
    </SettingsForm>
  );
}
