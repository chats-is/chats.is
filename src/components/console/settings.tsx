import { useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AudioLines,
  CalendarCheck,
  CalendarClock,
  Clapperboard,
  Film,
  Gauge,
  Globe,
  Hash,
  Image,
  Loader2,
  MessageSquare,
  Mic,
  PenLine,
  Percent,
  ReceiptText,
  Search,
  TicketPercent,
  Tickets,
  Type,
  Video,
  Volume2,
  type LucideIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { type ModelStatus } from '@/types/model';
import {
  GRACE_DAYS_CHOICES,
  GRACE_DAYS_DEFAULT,
  REFUND_DAYS_CHOICES,
  REFUND_DAYS_DEFAULT,
  REFUND_FEE_DEFAULT,
  REFUND_FEE_OPTIONS,
  REFUND_REQUESTS_CHOICES
} from '@/types/payment';
import { describeMultiplier } from '@/lib/billing';
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
import { tierQueries } from '@/server/functions/tier';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAppForm } from '@/components/app-form';
import { ModelStatusBadge } from '@/components/console/model-status';
import { PaymentConfigurationButton } from '@/components/console/payment-configuration';
import { TierLabel } from '@/components/console/tier-label';

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

const GRACE_DAYS_OPTIONS = GRACE_DAYS_CHOICES.map(n => ({
  value: n,
  label: n === '1' ? '1 day' : `${n} days`
}));

const REFUND_DAYS_OPTIONS = REFUND_DAYS_CHOICES.map(n => ({
  value: n,
  label: n === '1' ? '1 day' : `${n} days`
}));

/** Refund Requests' choice for no limit, which is saved as no value: a
 *  select cannot offer an empty one. */
const UNLIMITED = 'unlimited';
const REFUND_REQUESTS_OPTIONS = [
  { value: UNLIMITED, label: 'Unlimited' },
  ...REFUND_REQUESTS_CHOICES.map(n => ({ value: n, label: n }))
];

/** Every key the page loads and saves: the ten model picks, then the
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
  'subscriptions.enabled',
  'subscriptions.graceDays',
  'refunds.enabled',
  'refunds.fee',
  'refunds.days',
  'refunds.maxRequests',
  'webSearch.mode',
  'default.quotaId',
  'billing.tierId'
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
      <BillingSettings form={form} />
      <SubscriptionSettings form={form} />
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

/** What a user is charged when neither they nor their plan says. */
function BillingSettings({ form }: { form: SettingsFormApi }) {
  const { data: tierOptions } = useQuery(tierQueries.listForSelect());
  const value = useStore(form.store, state =>
    readPath(state.values, 'billing.tierId')
  );

  const tiers = (tierOptions ?? []).map(tier => ({
    value: tier.id,
    label: `${tier.name} ${describeMultiplier(tier.priceMultiplier)}`,
    node: <TierLabel name={tier.name} priceMultiplier={tier.priceMultiplier} />
  }));

  return (
    <SettingsList title="Billing">
      <SettingsRow
        icon={Percent}
        label="Default Tier"
        htmlFor="billing.tierId"
        hint="Used when neither the user nor their plan has a tier. Unset: the cost price and every model."
        settingKey="billing.tierId"
        state={value ? 'set' : 'unset'}
      >
        <form.AppField name="billing.tierId">
          {field => (
            <field.SelectField
              options={tiers}
              disabled={tiers.length === 0}
              placeholder={
                tiers.length === 0 ? 'No tiers available' : 'No tier'
              }
            />
          )}
        </form.AppField>
      </SettingsRow>
    </SettingsList>
  );
}

/**
 * The subscriptions feature, on or off — a subscription already bought keeps
 * running either way, and its user can still manage it — and the refunds a
 * user makes themselves: on or off, the share of a payment that goes back,
 * and for how long after it. The two switches are apart: a refund is of
 * money already paid, so it does not follow whether plans are still sold.
 * An admin refunds from Payments whatever the refund switch says.
 */
function SubscriptionSettings({ form }: { form: SettingsFormApi }) {
  return (
    <SettingsList title="Subscriptions">
      <SettingsRow
        icon={CalendarCheck}
        label={
          <span className="inline-flex items-center gap-1.5">
            Enable Subscriptions
            <PaymentConfigurationButton />
          </span>
        }
        htmlFor="subscriptions.enabled"
        hint="Whether subscriptions are available. Existing subscriptions keep running when it is off."
        settingKey="subscriptions.enabled"
      >
        <form.Field name="subscriptions.enabled">
          {field => (
            <Switch
              id="subscriptions.enabled"
              checked={field.state.value === 'true'}
              onCheckedChange={checked => field.handleChange(String(checked))}
            />
          )}
        </form.Field>
      </SettingsRow>
      <SettingsRow
        icon={CalendarClock}
        label="Subscription Grace Period"
        htmlFor="subscriptions.graceDays"
        hint="How many days past its period end a subscription goes on when its renewal payment has failed, while the payment processor retries it. Still unpaid after that, the subscription ends, here and in the payment processor."
        settingKey="subscriptions.graceDays"
      >
        <form.AppField name="subscriptions.graceDays">
          {field => (
            <field.SelectField options={GRACE_DAYS_OPTIONS} className="w-28" />
          )}
        </form.AppField>
      </SettingsRow>
      <SettingsRow
        icon={Tickets}
        label="Enable Refunds"
        htmlFor="refunds.enabled"
        hint="Whether users can request a refund."
        settingKey="refunds.enabled"
      >
        <form.Field name="refunds.enabled">
          {field => (
            <Switch
              id="refunds.enabled"
              checked={field.state.value === 'true'}
              onCheckedChange={checked => field.handleChange(String(checked))}
            />
          )}
        </form.Field>
      </SettingsRow>
      <SettingsRow
        icon={TicketPercent}
        label="Refund Fee"
        htmlFor="refunds.fee"
        hint="What is kept back from a refund. Auto: the fee the payment processor charged on the payment, or nothing where it does not say its fee. A percentage: that share of what was paid."
        settingKey="refunds.fee"
      >
        <form.AppField name="refunds.fee">
          {field => (
            <field.SelectField
              options={[...REFUND_FEE_OPTIONS]}
              className="w-28"
            />
          )}
        </form.AppField>
      </SettingsRow>
      <SettingsRow
        icon={CalendarClock}
        label="Refund Window"
        htmlFor="refunds.days"
        hint="How many days after a payment the user can still request a refund of it."
        settingKey="refunds.days"
      >
        <form.AppField name="refunds.days">
          {field => (
            <field.SelectField options={REFUND_DAYS_OPTIONS} className="w-28" />
          )}
        </form.AppField>
      </SettingsRow>
      <SettingsRow
        icon={Hash}
        label="Refund Requests"
        htmlFor="refunds.maxRequests"
        hint="How many times a user can request a refund for one subscription. A rejected request counts; once they are used up, no more can be made."
        settingKey="refunds.maxRequests"
      >
        <form.AppField name="refunds.maxRequests">
          {field => (
            <field.SelectField
              options={REFUND_REQUESTS_OPTIONS}
              className="w-28"
            />
          )}
        </form.AppField>
      </SettingsRow>
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
      const saved = keys.map(key => ({
        key,
        value:
          key === 'refunds.maxRequests' && readPath(value, key) === UNLIMITED
            ? null
            : readPath(value, key) || null
      }));
      await mutation.mutateAsync(saved);
      // The cache first, then the form. The form is handed the cached rows
      // as its defaults on every render, and takes new defaults over values
      // nobody has touched — so reset against the rows as they were, it
      // would show them again until the refetch came back: a switch just
      // turned on would flick off, then on.
      queryClient.setQueryData(settingsQueries.list().queryKey, rows =>
        rows ? withSaved(rows, saved) : rows
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

/** The cached rows with a save applied: each key's value replaced, and a key
 *  that had no row given one, as the server has just done. */
function withSaved<TRow extends { key: string; value: string | null }>(
  rows: TRow[],
  saved: Array<{ key: string; value: string | null }>
): TRow[] {
  const values = new Map(saved.map(s => [s.key, s.value]));
  const next = rows.map(row =>
    values.has(row.key) ? { ...row, value: values.get(row.key) ?? null } : row
  );
  for (const { key, value } of saved) {
    if (!rows.some(row => row.key === key)) {
      next.push({ ...rows[0], id: key, key, value });
    }
  }
  return next;
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
  flat['subscriptions.enabled'] ||= 'false';
  flat['subscriptions.graceDays'] ||= String(GRACE_DAYS_DEFAULT);
  flat['refunds.enabled'] ||= 'false';
  flat['refunds.fee'] ||= REFUND_FEE_DEFAULT;
  flat['refunds.days'] ||= String(REFUND_DAYS_DEFAULT);
  flat['refunds.maxRequests'] ||= UNLIMITED;
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
