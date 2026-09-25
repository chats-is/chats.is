import { useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AudioLines,
  Clapperboard,
  Film,
  Gauge,
  Globe,
  Image,
  Loader2,
  MessageSquare,
  Mic,
  PenLine,
  ReceiptText,
  Search,
  Type,
  Video,
  Volume2,
  type LucideIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { type ModelStatus } from '@/types/model';
import {
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_NAME,
  DEFAULT_APP_SUBTITLE
} from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { cn } from '@/lib/utils';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import {
  bulkUpdateSettings,
  settingsQueries
} from '@/server/functions/settings';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAppForm } from '@/components/app-form';
import { ModelStatusBadge } from '@/components/console/model-status';

import { expand, readPath } from './settings-values';

/**
 * Everything an admin sets about this installation, on one page.
 *
 * Seventeen settings in seven groups, read down: what the installation calls
 * itself, the defaults the user's picks fall back on, what every chat is told
 * and named by, then speech, web search and the quota. One form and one Save
 * cover the lot.
 */

// ---------------------------------------------------------------------------
// The settings this page owns
// ---------------------------------------------------------------------------

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
  supportsWebSearch?: boolean | null;
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

/** The model that names a chat. Its own group: naming is a job of the app's,
 *  not a default the user's choice falls back on. */
const TITLE_MODEL_ROW: ModelRow = {
  key: 'title.modelId',
  label: 'Title Generation Model',
  icon: Type,
  hint: "The model used to generate a conversation's title.",
  can: model => model.capability === 'chat'
};

/** Eight settings that ask the same question in eight places, so they are
 *  one list of eight rows rather than a grid of selects. */
const MODEL_ROWS: Array<ModelRow> = [
  {
    key: 'default.chat.modelId',
    label: 'Default Chat Model',
    icon: MessageSquare,
    hint: 'The default model for chat.',
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

/** The model that answers a search for a chat model without one: a chat
 *  model with search of its own. Beside the mode, not among the defaults —
 *  the two are read together. */
const WEB_SEARCH_MODEL_ROW: ModelRow = {
  key: 'webSearch.modelId',
  label: 'Web Search Model',
  icon: Search,
  hint: 'The model that searches for a chat model without a web search of its own. Its name is never shown to the user.',
  can: model => model.capability === 'chat' && !!model.supportsWebSearch
};

/** Who searches. Each value names a source, so a third — a search service
 *  of its own — is one more entry here. */
const WEB_SEARCH_MODES = [
  { value: 'auto', label: 'Auto' },
  { value: 'model', label: 'Model' }
];

/** Every key the page loads and saves: the ten model picks, then the seven
 *  fields that are not one. */
const KEYS = [
  TITLE_MODEL_ROW.key,
  ...MODEL_ROWS.map(row => row.key),
  WEB_SEARCH_MODEL_ROW.key,
  'app.name',
  'app.subtitle',
  'app.description',
  'chat.systemPrompt',
  'speech.enabled',
  'webSearch.mode',
  'default.quotaId'
];

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * The order is what the installation is, then what it runs on: the app's own
 * fields first — its name — then the model picks and the chat's own settings,
 * group by group, then the switches and the quota.
 */
export function ConsoleSettings() {
  const { form, isHeld } = useSettingsForm(KEYS);

  return (
    <SettingsForm form={form} isHeld={isHeld}>
      <ApplicationSettings form={form} />
      <ModelDefaults form={form} />
      <ChatSettings form={form} />
      <SpeechSettings form={form} />
      <WebSearchSettings form={form} />
      <QuotaSettings form={form} />
    </SettingsForm>
  );
}

/** What this installation calls itself. */
function ApplicationSettings({ form }: { form: SettingsFormApi }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <h2 className="border-b bg-muted/50 px-4 py-3 text-sm font-medium">
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
  );
}

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

/** Which model this installation uses for each job it has to do. */
function ModelDefaults({ form }: { form: SettingsFormApi }) {
  const { data: models } = useQuery(modelQueries.forSelect());

  // The live form values, so a row settles the moment a model is picked rather
  // than waiting for a save.
  const values = useStore(form.store, state => state.values);

  const statuses = MODEL_ROWS.map(row =>
    statusOf(readPath(values, row.key), row, models)
  );
  const set = statuses.filter(state => state === 'set').length;
  const stale = statuses.filter(state => state === 'stale').length;

  return (
    <SettingsList
      title="Default Models"
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
      {MODEL_ROWS.map((row, index) => (
        <ModelPickRow
          key={row.key}
          form={form}
          row={row}
          state={statuses[index]}
          models={models}
        />
      ))}
    </SettingsList>
  );
}

/** One "pick a model for this job" row. */
function ModelPickRow({
  form,
  row,
  state,
  models
}: {
  form: SettingsFormApi;
  row: ModelRow;
  state: RowState;
  models: Array<ModelLike> | undefined;
}) {
  // Every model the job could use, the ones that cannot answer today
  // included: a model that is switched off is a thing the admin can go and
  // switch on, and leaving it out only raises the question of where it went.
  // The badge says which; it does not bar the choice.
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
              options.length === 0 ? 'No available models' : 'Select model'
            }
          />
        )}
      </form.AppField>
    </SettingsRow>
  );
}

/** One switch, in the row the model picks use: the same shape says the same
 *  thing — a setting, its name, and the control that sets it at the right. */
function SpeechSettings({ form }: { form: SettingsFormApi }) {
  return (
    <SettingsList title="Speech">
      <SettingsRow
        icon={Volume2}
        label="Enable Speech"
        htmlFor="speech.enabled"
        hint="Whether a message can be read aloud."
        settingKey="speech.enabled"
      >
        {/* Settings are stored as text, so this switch is over "true"/"false"
            rather than a boolean, and binds by hand. */}
        <form.Field name="speech.enabled">
          {field => (
            <Switch
              id="speech.enabled"
              checked={field.state.value === 'true'}
              onCheckedChange={checked => field.handleChange(String(checked))}
            />
          )}
        </form.Field>
      </SettingsRow>
    </SettingsList>
  );
}

/** What every chat is told before the user speaks, and the model that
 *  names one. Both are about the conversation rather than any one model. */
function ChatSettings({ form }: { form: SettingsFormApi }) {
  const { data: models } = useQuery(modelQueries.forSelect());
  const modelId = useStore(form.store, state =>
    readPath(state.values, TITLE_MODEL_ROW.key)
  );

  return (
    <SettingsList title="Chat">
      <SettingsRow
        icon={ReceiptText}
        label="System Prompt"
        htmlFor="chat.systemPrompt"
        hint="Told to every chat model, after the app's own system prompt. A model's own system prompt follows it rather than replacing it."
        settingKey="chat.systemPrompt"
        stacked
      >
        <form.AppField name="chat.systemPrompt">
          {field => <field.TextareaField rows={8} />}
        </form.AppField>
      </SettingsRow>
      <ModelPickRow
        form={form}
        row={TITLE_MODEL_ROW}
        state={statusOf(modelId, TITLE_MODEL_ROW, models)}
        models={models}
      />
    </SettingsList>
  );
}

/** How a chat searches: the mode, and the model the mode falls back on or
 *  always uses. Read together, so they sit together. */
function WebSearchSettings({ form }: { form: SettingsFormApi }) {
  const { data: models } = useQuery(modelQueries.forSelect());
  const modelId = useStore(form.store, state =>
    readPath(state.values, WEB_SEARCH_MODEL_ROW.key)
  );

  return (
    <SettingsList title="Web search">
      <SettingsRow
        icon={Globe}
        label="Search Mode"
        htmlFor="webSearch.mode"
        hint="Auto uses the chat model's own web search when it has one, and the web search model otherwise. Model always uses the web search model."
        settingKey="webSearch.mode"
      >
        <form.AppField name="webSearch.mode">
          {field => <field.SelectField options={WEB_SEARCH_MODES} />}
        </form.AppField>
      </SettingsRow>
      <ModelPickRow
        form={form}
        row={WEB_SEARCH_MODEL_ROW}
        state={statusOf(modelId, WEB_SEARCH_MODEL_ROW, models)}
        models={models}
      />
    </SettingsList>
  );
}

/** What a user may spend when nothing else has said. */
function QuotaSettings({ form }: { form: SettingsFormApi }) {
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());
  const value = useStore(form.store, state =>
    readPath(state.values, 'default.quotaId')
  );

  const quotas = (quotaOptions ?? []).map(quota => ({
    value: quota.id,
    label: quota.name + (quota.isUnlimited ? ' (Unlimited)' : '')
  }));

  return (
    <SettingsList title="Quota">
      <SettingsRow
        icon={Gauge}
        label="Default Quota"
        htmlFor="default.quotaId"
        hint="The default quota, used when a user has no other."
        settingKey="default.quotaId"
        state={value ? 'set' : 'unset'}
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
  );
}

// ---------------------------------------------------------------------------
// A setting as a row
// ---------------------------------------------------------------------------

/**
 * A group of settings read down rather than a grid of fields: each setting
 * gets a row of its own — what it is on the left, the control on the right,
 * and every control ending on the same edge so the column can be scanned.
 */
function SettingsList({
  title,
  aside,
  children
}: {
  title: React.ReactNode;
  /** Shown at the right of the heading, for a tally or a count. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      {/* The weight the console's table headers carry, so a band over rows
          reads the same here as it does over a table. Horizontal padding stays
          at the rows' own, so the heading starts where they do. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b bg-muted/50 px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside}
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

/** How a row reads at a glance. `stale` is a value naming something that is
 *  no longer on offer. */
type RowState = 'set' | 'unset' | 'stale';

const ROW_TINT: Record<RowState, string> = {
  set: '',
  unset: 'bg-muted/25',
  stale: 'bg-amber-50 dark:bg-amber-950/25'
};

function SettingsRow({
  icon: Icon,
  label,
  htmlFor,
  hint,
  settingKey,
  state = 'set',
  stacked = false,
  children
}: {
  /** Widened from lucide's own type so the skeleton can stand one in. */
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  /** Omitted for a row whose control labels itself. */
  htmlFor?: string;
  hint?: React.ReactNode;
  /** The key this row writes, for whoever is reading the database. */
  settingKey: React.ReactNode;
  state?: RowState;
  /** The control under the header at full width — for a block of text
   *  rather than a pick. */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-center gap-3 p-4',
        !stacked && 'sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6',
        ROW_TINT[state]
      )}
    >
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="font-medium">
              {label}
            </label>
          ) : (
            <div className="font-medium">{label}</div>
          )}
          {hint && (
            <div className="mt-0.5 max-w-[60ch] text-sm text-muted-foreground">
              {hint}
            </div>
          )}
          <div className="mt-1 font-mono text-[11px] text-muted-foreground/75">
            {settingKey}
          </div>
        </div>
      </div>

      {/* The control: at the right for a pick or a switch, or under the
          header for a block of text — starting where the label does, past
          the icon, so the two read as one column. */}
      {stacked ? (
        <div className="flex min-w-0 flex-col pl-[30px]">{children}</div>
      ) : (
        <div className="flex min-w-0 justify-end sm:justify-self-end">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/**
 * Load the settings, track edits, and save just these keys.
 *
 * `bulkUpdate` upserts only the keys it is given, so a save never touches a
 * row this page does not show.
 *
 * A setting key is a dotted path (`app.name`, `default.chat.modelId`), which
 * is exactly how the form addresses a nested field — so the keys are expanded
 * into an object here and a block names its fields with the key itself.
 */
function useSettingsForm(keys: readonly string[]) {
  const queryClient = useQueryClient();
  const { data: settings, isFetching } = useQuery(settingsQueries.list());

  const mutation = useMutation({
    mutationFn: mutating(bulkUpdateSettings),
    onSuccess: () => {
      // Every reader of the settings table, not only the list this form
      // edits: the app's name and the system settings are the same rows read
      // from elsewhere, out of the same cache, and a save that cleared only
      // this page would leave them showing what was there before.
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Settings saved successfully');
    },
    onError: error => toast.error(error.message)
  });

  const form = useAppForm({
    // Built on the first render rather than reset into place afterwards: the
    // route prefetches this query, so the values are already in the cache when
    // the form is created — including on the server, where an effect would
    // never run and the page would have rendered a placeholder instead.
    defaultValues: valuesOf(settings),
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(
        keys.map(key => ({ key, value: readPath(value, key) || null }))
      );
      // The values just saved become the ones "no changes" is measured from,
      // so the Save button settles rather than staying lit.
      form.reset(value);
    }
  });

  // Read inside the effect without making it a dependency — depending on it
  // would re-run the sync on the very edit it is meant to protect.
  const isDirty = useStore(form.store, state => state.isDirty);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Only for what arrives after that first render. `settings.list` refetches
  // in the background once it is stale and the view is mounted again, which
  // would otherwise leave the form showing values the server no longer has.
  const settled = useRef(settings);

  useEffect(() => {
    if (!settings || settled.current === settings) return;
    settled.current = settings;

    // Leave edits alone: overwriting them would be silent, since the same pass
    // clears the dirty flag and disables Save. The next successful save
    // re-reads from the server anyway.
    if (isDirtyRef.current) return;

    form.reset(valuesOf(settings));
  }, [settings, form]);

  // Held while the values are on their way — drawn from what was held, if
  // anything was, but not to be edited until they are what the server has.
  // Not once something has been edited: that read is going to be ignored.
  const isHeld = isFetching && !isDirty;

  return { form, isHeld };
}

/** The rows as the form holds them: dotted keys expanded into an object. */
function valuesOf(
  settings: Array<{ key: string; value: string | null }> | undefined
) {
  const flat: Record<string, string> = {};
  (settings ?? []).forEach(setting => {
    flat[setting.key] = setting.value || '';
  });
  // A switch needs a side even before anyone has picked one.
  flat['speech.enabled'] ||= 'false';
  flat['webSearch.mode'] ||= 'auto';
  return expand(flat);
}

/**
 * The form this page holds. Its values are a tree of strings whose shape
 * depends on which keys the page owns, so the typing stops here.
 */
type SettingsFormApi = ReturnType<typeof useSettingsForm>['form'];

/**
 * The page's fields, and the Save that commits them. Submitting is what
 * saves, so the button is inside the form rather than wired to a handler.
 * Held — every field and the button — while the values are being read.
 */
function SettingsForm({
  form,
  isHeld,
  children
}: {
  form: SettingsFormApi;
  isHeld: boolean;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <fieldset disabled={isHeld} className="min-w-0 space-y-6">
        {children}
        <SettingsSaveBar form={form} />
      </fieldset>
    </form>
  );
}

/**
 * Save, lit only once something has actually been edited. The form is the one
 * that knows, so the bar reads it rather than being told.
 */
function SettingsSaveBar({ form }: { form: SettingsFormApi }) {
  const isDirty = useStore(form.store, state => state.isDirty);
  const isSubmitting = useStore(form.store, state => state.isSubmitting);

  return (
    <div className="flex items-center justify-start">
      <Button
        type="submit"
        disabled={!isDirty || isSubmitting}
        className="gap-2"
      >
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );
}
