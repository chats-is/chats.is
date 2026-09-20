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

import { type ModelStatus } from '@/types/model';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ModelStatusBadge } from '@/components/console/model-status';

import { SettingsList, SettingsRow, type RowState } from './list';
import { DefaultsPending } from './pending';
import { SettingsForm, useSettingsForm } from './shared';
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
  /** Worked out by the server from this model's switch and its providers'. */
  status: ModelStatus;
  supportsImageEdit?: boolean | null;
  supportsImageToVideo?: boolean | null;
  supportsVideoEdit?: boolean | null;
  supportsTranscription?: boolean | null;
};

/** One "pick a model for this job" setting. `can` is what the job asks of a
 *  model — a capability, sometimes a flag beside it. Whether the model can
 *  answer at all is its status, which is a separate question. */
type ModelRow = {
  key: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  can: (model: ModelLike) => boolean;
};

const MODEL_ROWS: Array<ModelRow> = [
  {
    key: 'default.chat.modelId',
    label: 'Default Chat Model',
    icon: MessageSquare,
    hint: 'The default model for chat.',
    can: model => model.capability === 'chat'
  },
  {
    key: 'title.modelId',
    label: 'Title Generation Model',
    icon: Type,
    hint: "The model used to generate a conversation's title.",
    can: model => model.capability === 'chat'
  },
  {
    key: 'default.image.modelId',
    label: 'Default Image Model',
    icon: Image,
    hint: "The default model for the chat's image tool.",
    can: model => model.capability === 'image'
  },
  {
    key: 'default.image.editModelId',
    label: 'Default Image Edit Model',
    icon: PenLine,
    hint: "The default model for the chat's image editing tool.",
    can: model => model.capability === 'image' && !!model.supportsImageEdit
  },
  {
    key: 'default.video.modelId',
    label: 'Default Video Model',
    icon: Video,
    hint: "The default model for the chat's video tool.",
    can: model => model.capability === 'video'
  },
  {
    key: 'default.video.imageModelId',
    label: 'Default Image-to-Video Model',
    icon: Film,
    hint: "The default model for the chat's image-to-video tool.",
    can: model => model.capability === 'video' && !!model.supportsImageToVideo
  },
  {
    key: 'default.video.editModelId',
    label: 'Default Video Edit Model',
    icon: Clapperboard,
    hint: "The default model for the chat's video editing tool.",
    can: model => model.capability === 'video' && !!model.supportsVideoEdit
  },
  {
    key: 'default.tts.modelId',
    label: 'Default TTS Model',
    icon: AudioLines,
    hint: "The default model for the chat's text-to-speech tool and for reading a message aloud.",
    can: model => model.capability === 'audio' && !model.supportsTranscription
  },
  {
    key: 'default.stt.modelId',
    label: 'Default Transcription Model',
    icon: Mic,
    hint: "The default model for the chat's transcription tool.",
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
): RowState {
  if (typeof value !== 'string' || !value) return 'unset';
  // Nothing to check against until the list lands.
  if (!models) return 'set';

  const model = models.find(candidate => candidate.modelId === value);
  if (!model) return 'stale';
  if (model.status !== 'available') return 'stale';
  // Still here and still usable, but no longer up to this particular job.
  return row.can(model) ? 'set' : 'stale';
}

export function DefaultsSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);
  const { data: models } = useQuery(modelQueries.forSelect());
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());

  // The live form values, so a row settles the moment a model is picked rather
  // than waiting for a save.
  const values = useStore(form.store, state => state.values);

  if (isLoading) return <DefaultsPending />;

  const statuses = MODEL_ROWS.map(row =>
    statusOf(readPath(values, row.key), row, models)
  );
  const set = statuses.filter(state => state === 'set').length;
  const stale = statuses.filter(state => state === 'stale').length;

  const quotas = (quotaOptions ?? []).map(quota => ({
    value: quota.id,
    label: quota.name + (quota.isUnlimited ? ' (Unlimited)' : '')
  }));

  return (
    <SettingsForm form={form}>
      <SettingsList
        title="Models"
        aside={
          <span className="text-sm font-normal text-muted-foreground">
            {set} of {MODEL_ROWS.length} set
            {stale > 0 && (
              <>
                {' · '}
                <b className="font-medium text-amber-700 dark:text-amber-400">
                  {stale} unavailable
                </b>
              </>
            )}
          </span>
        }
      >
        {MODEL_ROWS.map((row, index) => {
          const state = statuses[index];
          // Every model the job could use, the ones that cannot answer today
          // included: a model that is switched off is a thing the admin can go
          // and switch on, and leaving it out only raises the question of
          // where it went. The badge says which; it does not bar the choice.
          const options = (models ?? [])
            .filter(model => row.can(model))
            .map(model => ({
              value: model.modelId,
              label: model.name,
              node: (
                <span className="flex items-center gap-2">
                  {model.name}
                  <ModelStatusBadge status={model.status} />
                </span>
              )
            }));

          return (
            <SettingsRow
              key={row.key}
              icon={row.icon}
              label={row.label}
              htmlFor={row.key}
              hint={row.hint}
              settingKey={row.key}
              state={state}
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
          hint="Whether a message can be read aloud."
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

      <SettingsList title="Quota">
        <SettingsRow
          icon={Gauge}
          label="Default Quota"
          htmlFor="default.quotaId"
          hint="The default quota, used when a user has no other."
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
