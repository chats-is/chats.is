import { useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import {
  AudioLines,
  CalendarCheck,
  CalendarClock,
  Clapperboard,
  Eraser,
  Film,
  Gauge,
  Globe,
  Hash,
  Image,
  MessageSquare,
  Mic,
  PenLine,
  Percent,
  Search,
  SquareSparkles,
  TicketPercent,
  Tickets,
  Type,
  Video,
  Volume2,
  type LucideIcon
} from 'lucide-react';

import { type ModelStatus } from '@/types/model';
import { type ProviderType } from '@/types/provider';
import { describeMultiplier } from '@/lib/billing';
import {
  DEFAULT_APP_DESCRIPTION,
  DEFAULT_APP_NAME,
  DEFAULT_APP_SUBTITLE,
  GRACE_DAYS_CHOICES,
  GRACE_DAYS_DEFAULT,
  REFUND_DAYS_CHOICES,
  REFUND_DAYS_DEFAULT,
  REFUND_FEE_DEFAULT,
  REFUND_FEE_OPTIONS,
  REFUND_REQUESTS_CHOICES,
  TRANSPARENT_BACKGROUND_PROVIDERS
} from '@/lib/constant';
import { cn } from '@/lib/utils';
import { modelQueries } from '@/server/functions/model';
import { quotaQueries } from '@/server/functions/quota';
import { tierQueries } from '@/server/functions/tier';
import { Switch } from '@/components/ui/switch';
import { PaymentHelpButton } from '@/components/console/payment-help';
import { TierLabel } from '@/components/console/tier-label';

import {
  SettingsForm,
  useSettingsForm,
  type SettingsFormApi
} from './settings-form';
import { readPath } from './settings-values';

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
  providers?: Array<{
    provider: { type: ProviderType; image: string | null } | null;
  }>;
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
  /** Offers None: a job the app can go without, switched off by it. */
  optional?: boolean;
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

/** The model that takes an image's background away, whichever image model
 *  the user picked: an image model that edits, served through a provider
 *  that can make a background transparent. */
const BACKGROUND_REMOVAL_MODEL_ROW: ModelRow = {
  key: 'backgroundRemoval.modelId',
  label: 'Background Removal Model',
  icon: Eraser,
  hint: "The model the chat's background removal tool uses, whichever image model the user picked. Only image models that edit and are served through OpenAI, Azure or Bedrock are listed — no other image API can make a transparent background. None leaves the tool off.",
  can: model =>
    model.capability === 'image' &&
    !!model.supportsImageEdit &&
    !!model.providers?.some(
      binding =>
        binding.provider &&
        TRANSPARENT_BACKGROUND_PROVIDERS.includes(binding.provider.type)
    ),
  optional: true
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

/** Max Refund Requests' choice for no limit, which is saved as no value: a
 *  select cannot offer an empty one. */
const UNLIMITED = 'unlimited';
const REFUND_REQUESTS_OPTIONS = [
  { value: UNLIMITED, label: 'Unlimited' },
  ...REFUND_REQUESTS_CHOICES.map(n => ({ value: n, label: n }))
];

/** Every key the page loads and saves: the eleven model picks, then the
 *  fields that are not one. */
const KEYS = [
  TITLE_MODEL_ROW.key,
  ...MODEL_ROWS.map(row => row.key),
  WEB_SEARCH_MODEL_ROW.key,
  BACKGROUND_REMOVAL_MODEL_ROW.key,
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

/** What a field shows before its setting has a value: a switch needs a side
 *  even before anyone has picked one, and a choice its default. */
const DEFAULTS: Record<string, string> = {
  'speech.enabled': 'false',
  'subscriptions.enabled': 'false',
  'subscriptions.graceDays': String(GRACE_DAYS_DEFAULT),
  'refunds.enabled': 'false',
  'refunds.fee': REFUND_FEE_DEFAULT,
  'refunds.days': String(REFUND_DAYS_DEFAULT),
  'refunds.maxRequests': UNLIMITED,
  'webSearch.mode': 'auto'
};

/** What is saved for a field: no value for an empty one, and for Max Refund
 *  Requests' Unlimited, which a select cannot offer as empty. */
const toValue = (key: string, value: string) =>
  key === 'refunds.maxRequests' && value === UNLIMITED ? null : value || null;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * The order is what the installation is, then what it runs on: the app's own
 * fields first — its name — then the model picks and the chat's own settings,
 * group by group, then the switches and the quota.
 */
export function ConsoleSettings() {
  const { form, isHeld } = useSettingsForm(KEYS, {
    defaults: DEFAULTS,
    toValue
  });

  return (
    <SettingsForm form={form} isHeld={isHeld}>
      <ApplicationSettings form={form} />
      <ModelDefaults form={form} />
      <ChatSettings form={form} />
      <SpeechSettings form={form} />
      <WebSearchSettings form={form} />
      <BackgroundRemovalSettings form={form} />
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
  return (
    <SettingsRow
      icon={row.icon}
      label={row.label}
      htmlFor={row.key}
      hint={row.hint}
      settingKey={row.key}
      state={state}
    >
      {/* Every model the job could use, the ones that cannot answer today
          included: a model that is switched off is a thing the admin can go
          and switch on, and leaving it out only raises the question of where
          it went. */}
      <form.AppField name={row.key}>
        {field => (
          <field.ModelField
            models={models ?? []}
            groups={[{ label: row.label, can: row.can }]}
            empty={row.optional}
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
        icon={SquareSparkles}
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

/** The model the chat's background removal tool runs on. */
function BackgroundRemovalSettings({ form }: { form: SettingsFormApi }) {
  const { data: models } = useQuery(modelQueries.forSelect());
  const modelId = useStore(form.store, state =>
    readPath(state.values, BACKGROUND_REMOVAL_MODEL_ROW.key)
  );

  return (
    <SettingsList title="Background removal">
      <ModelPickRow
        form={form}
        row={BACKGROUND_REMOVAL_MODEL_ROW}
        state={statusOf(modelId, BACKGROUND_REMOVAL_MODEL_ROW, models)}
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
            <PaymentHelpButton />
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
        label="Max Refund Requests"
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
