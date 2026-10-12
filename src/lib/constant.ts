import {
  CalendarCheck,
  ChartLine,
  CircleDollarSign,
  Cpu,
  CreditCard,
  Gauge,
  LayoutGrid,
  LibraryBig,
  Logs,
  MessageSquare,
  Package,
  Percent,
  Plug,
  Settings,
  SquareSparkles,
  Tickets,
  Users
} from 'lucide-react';

import { type ChatMediaToolName } from '@/types/chat-tools';
import { type ModelCapability } from '@/types/model';
import {
  type BillingInterval,
  type PaymentKind,
  type PaymentProcessorId,
  type PaymentStatus,
  type RefundRequestStatus,
  type SubscriptionReason,
  type SubscriptionStatus
} from '@/types/payment';
import { type MediaOptionKey } from '@/lib/media-settings';

/**
 * What this installation calls itself before an admin says otherwise.
 *
 * Read from here by both the settings query and the title builder — they used
 * to keep a copy each, with a comment on one asking that they be kept in
 * step, which is the kind of promise a rename breaks quietly.
 */
export const DEFAULT_APP_NAME = 'Chats.is';
export const DEFAULT_APP_SUBTITLE = 'Your AI Assistant';
export const DEFAULT_APP_DESCRIPTION =
  'Chats.is is an AI assistant that answers questions, writes, makes images and video, and turns ideas into code you can run.';

/**
 * Provider types for the console
 */
export const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'google', label: 'Google AI' },
  { value: 'vertex', label: 'Google Vertex AI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'xai', label: 'xAI' },
  { value: 'deepseek', label: 'DeepSeek' }
] as const;

/**
 * Model and prompt capabilities
 */
export const CAPABILITIES = [
  { value: 'chat', label: 'Chat' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' }
] satisfies Array<{ value: ModelCapability; label: string }>;

/**
 * Image size labels mapping
 */
export const IMAGE_SIZE_LABELS: Record<string, string> = {
  auto: 'Auto',
  '256x256': 'Small Square (256x256)',
  '512x512': 'Medium Square (512x512)',
  '1024x1024': 'Large Square (1024x1024)',
  '512': '512px',
  '1K': '1K',
  '2K': '2K',
  '4K': '4K',
  '1536x1024': 'Landscape (1536x1024)',
  '1024x1536': 'Portrait (1024x1536)',
  '1792x1024': 'Landscape (1792x1024)',
  '1024x1792': 'Portrait (1024x1792)',
  '1280x720': 'Landscape (1280x720)',
  '720x1280': 'Portrait (720x1280)'
};

/**
 * Aspect ratio labels mapping
 */
export const ASPECT_RATIO_LABELS: Record<string, string> = {
  auto: 'Auto',
  '1:1': 'Square (1:1)',
  '1:4': 'Ultra Portrait (1:4)',
  '1:8': 'Ultra Portrait (1:8)',
  '2:3': 'Portrait (2:3)',
  '3:2': 'Landscape (3:2)',
  '3:4': 'Portrait (3:4)',
  '4:1': 'Ultra Landscape (4:1)',
  '4:3': 'Landscape (4:3)',
  '4:5': 'Portrait (4:5)',
  '5:4': 'Landscape (5:4)',
  '8:1': 'Ultra Landscape (8:1)',
  '9:16': 'Portrait (9:16)',
  '16:9': 'Landscape (16:9)',
  '21:9': 'Ultrawide (21:9)'
};

/**
 * Reasoning effort labels mapping
 */
export const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High'
};

/**
 * Video resolution labels mapping
 */
export const VIDEO_RESOLUTION_LABELS: Record<string, string> = {
  auto: 'Auto',
  '480p': '480p (SD)',
  '720p': '720p (HD)',
  '1080p': '1080p (Full HD)',
  '4k': '4K (Ultra HD)'
};

/**
 * Vertex AI model ID mapping (Anthropic model ID -> Vertex AI model ID)
 */
export const VERTEX_AI_MODELS: Record<string, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5@20250929',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5@20250929',
  'claude-opus-4-5': 'claude-opus-4-5@20251101',
  'claude-opus-4-5-20251101': 'claude-opus-4-5@20251101',
  'claude-haiku-4-5': 'claude-haiku-4-5@20251001',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5@20251001',
  'claude-opus-4-1': 'claude-opus-4-1@20250805',
  'claude-opus-4-1-20250805': 'claude-opus-4-1@20250805',
  'claude-sonnet-4-0': 'claude-sonnet-4@20250514',
  'claude-sonnet-4-20250514': 'claude-sonnet-4@20250514',
  'claude-opus-4-0': 'claude-opus-4@20250514',
  'claude-opus-4-20250514': 'claude-opus-4@20250514'
};

/**
 * AWS Bedrock model ID mapping (Anthropic model ID -> Bedrock model ID)
 */
export const BEDROCK_MODELS: Record<string, string> = {
  'claude-opus-4-6': 'anthropic.claude-opus-4-6-v1',
  'claude-sonnet-4-6': 'anthropic.claude-sonnet-4-6',
  'claude-sonnet-4-5': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-sonnet-4-5-20250929': 'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-opus-4-5': 'anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-opus-4-5-20251101': 'anthropic.claude-opus-4-5-20251101-v1:0',
  'claude-haiku-4-5': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-haiku-4-5-20251001': 'anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-opus-4-1': 'anthropic.claude-opus-4-1-20250805-v1:0',
  'claude-opus-4-1-20250805': 'anthropic.claude-opus-4-1-20250805-v1:0',
  'claude-sonnet-4-0': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-sonnet-4-20250514': 'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-opus-4-0': 'anthropic.claude-opus-4-20250514-v1:0',
  'claude-opus-4-20250514': 'anthropic.claude-opus-4-20250514-v1:0'
};

/**
 * What each media tool is for, said once — on the tool itself, as its
 * description, where the model reads it beside the parameters. The system
 * prompt no longer repeats it: two copies of the same guidance drifted apart.
 * The values a model offers (sizes, voices, durations) are appended per
 * model where the tool is registered.
 */
export const MEDIA_TOOL_GUIDANCE: Record<ChatMediaToolName, string> = {
  generate_image:
    'Create a new image from a text description. Use when the user asks for a picture, illustration, photo, logo, or any visual.',
  edit_image:
    "Modify an existing image from this conversation (a user upload or a previously generated image). Pass that image's URL as `imageUrl` and describe the change in `prompt`.",
  generate_video:
    'Create a video from a text description, or animate an image from this conversation by passing its URL as `imageUrl`.',
  edit_video:
    "Modify an existing video from this conversation (a user upload or a previously generated one) — use this whenever the user asks to change a video that already exists, never generate_video. Pass that video's URL as `videoUrl` and describe the change in `prompt`. Length, aspect ratio and resolution are inherited from the source.",
  text_to_speech:
    'Convert text to spoken audio (e.g. "read this aloud", "say this"). Pass the exact final text to speak — write it out first if it needs composing.',
  transcribe_audio:
    "Transcribe an audio file from this conversation to text (speech-to-text). Pass that audio's URL as `audioUrl`. Use when the user asks what an audio says or to transcribe it; translating or summarising the transcript is then yours to do."
};

export const ARTIFACT_SYSTEM_PROMPT = [
  'Use the create_artifact tool for substantial, self-contained, reusable content: code files, runnable React UIs, full documents, or data tables. Do NOT use it for short snippets, brief explanations, or conversational replies — keep those inline in the chat.',
  '',
  'Always set a concise, descriptive `title` (2–6 words) — it labels the artifact in the canvas and the artifact switcher.',
  '',
  'Choose `type`:',
  '- code: source code. Set `language` (e.g. tsx, ts, python, sql).',
  '- markdown / html / text: rendered or plain documents.',
  '- json: structured data; an array of row objects (or arrays) renders as a table.',
  '',
  'Always put the COMPLETE content in `content`. Never truncate or use placeholders like "// rest unchanged". Each create_artifact call produces a separate artifact; to revise something, create a new artifact with the full updated content.',
  '',
  'Live Preview is available for html, markdown, SVG (type code, language svg), and React/TS code. To make React/TS code previewable, follow this contract exactly:',
  '- Use type "code" with `language` one of react/tsx/jsx/typescript/javascript.',
  '- The entry/root file MUST `export default` the root React component — that default export is what Preview renders.',
  '- Every code artifact must set an exact relative `fileName`; name the entry file index.tsx.',
  '- Any file containing JSX must use a .tsx or .jsx fileName.',
  '- Keep it to ONE self-contained file: put every component/helper in this single artifact and do not import sibling files (other artifacts are not in scope).',
  '- Allowed package imports: react, react-dom, react-dom/client, lucide-react, framer-motion, recharts, clsx, class-variance-authority. No Next.js APIs, server code, env vars, remote assets, or any other npm package.',
  '- Styling: Tailwind utility classes work (a Tailwind v4 runtime is bundled into the preview), and inline styles or a <style> tag also work. CSS-file imports do NOT apply at runtime.',
  '',
  'HTML artifacts (type "html") must be a single self-contained document; inline <style>/<script> are fine. Preview runs sandboxed with no access to the host page.'
].join('\n');

/** Every processor a plan can be sold through, as the console offers them. */
export const PAYMENT_PROCESSORS: ReadonlyArray<{
  id: PaymentProcessorId;
  label: string;
  /** What the processor calls the ID a plan is sold by. */
  priceIdLabel: string;
  priceIdPlaceholder: string;
  /** Whether a subscription can be upgraded in place, the plan changing
   *  only once the difference is paid. Lemon Squeezy changes the plan
   *  whether or not that charge goes through, so it cannot. */
  upgrades: boolean;
  /** Whether it says what fee it kept on a payment, which a refund on
   *  `auto` goes by. Lemon Squeezy does not. */
  reportsFee: boolean;
}> = [
  {
    id: 'stripe',
    label: 'Stripe',
    priceIdLabel: 'Price ID',
    priceIdPlaceholder: 'price_...',
    upgrades: true,
    reportsFee: true
  },
  {
    id: 'paddle',
    label: 'Paddle',
    priceIdLabel: 'Price ID',
    priceIdPlaceholder: 'pri_...',
    upgrades: true,
    reportsFee: true
  },
  {
    id: 'lemonsqueezy',
    label: 'Lemon Squeezy',
    priceIdLabel: 'Variant ID',
    priceIdPlaceholder: '123456',
    upgrades: false,
    reportsFee: false
  }
];

/** Every interval a plan can be billed at, shortest first, as the pages
 *  offer them. `days` is about how long one is, to compare prices by. */
export const BILLING_INTERVALS: ReadonlyArray<{
  value: BillingInterval;
  label: string;
  /** "monthly", as in "billed monthly". */
  adverb: string;
  days: number;
}> = [
  { value: 'day', label: 'Daily', adverb: 'daily', days: 1 },
  { value: 'week', label: 'Weekly', adverb: 'weekly', days: 7 },
  { value: 'month', label: 'Monthly', adverb: 'monthly', days: 365.25 / 12 },
  { value: 'year', label: 'Yearly', adverb: 'yearly', days: 365.25 }
];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Active',
  canceled: 'Canceled',
  ended: 'Ended'
};

/** The statuses of a subscription in effect: it gives its user its plan. */
export const LIVE_STATUSES: ReadonlyArray<SubscriptionStatus> = [
  'active',
  'canceled'
];

export const SUBSCRIPTION_REASON_LABELS: Record<SubscriptionReason, string> = {
  canceled_by_customer: 'Canceled by customer',
  canceled_by_admin: 'Canceled by admin',
  refunded: 'Refunded',
  payment_failed: 'Payment failed',
  payment_disputed: 'Payment disputed',
  duplicate: 'Duplicate subscription',
  canceled_in_processor: 'Canceled in payment processor',
  paused_in_processor: 'Paused in payment processor'
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid',
  failed: 'Failed',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
  disputed: 'Disputed'
};

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  initial: 'Initial',
  renewal: 'Renewal',
  upgrade: 'Upgrade'
};

export const REFUND_REQUEST_STATUS_LABELS: Record<RefundRequestStatus, string> =
  {
    pending_approval: 'Pending approval',
    approved: 'Approved',
    rejected: 'Rejected'
  };

/** A payment money can still go back from. */
export const REFUNDABLE_STATUSES: ReadonlyArray<PaymentStatus> = ['paid'];

/**
 * What a refund keeps back of a payment (setting `refunds.fee`): `auto`, the
 * fee the processor kept on it — nothing where the processor does not say
 * its fee — or a percentage of what was paid.
 */
const REFUND_FEE_PERCENTS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30
] as const;

export const REFUND_FEE_DEFAULT = 'auto';

export const REFUND_FEE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'auto', label: 'Auto' },
  ...REFUND_FEE_PERCENTS.map(p => ({ value: String(p), label: `${p}%` }))
];

/** How many days after a payment a user may request a refund of it
 *  (`refunds.days`): from 1 to 15, 7 when unset. */
const REFUND_DAYS_MAX = 15;

export const REFUND_DAYS_DEFAULT = 7;

export const REFUND_DAYS_CHOICES = Array.from(
  { length: REFUND_DAYS_MAX },
  (_, i) => String(i + 1)
);

/**
 * How many refund requests a user can make on one subscription (setting
 * `refunds.maxRequests`), whatever was decided on them. Unset is no limit.
 * Once used up — the last one rejected — no more can be made.
 */
export const REFUND_REQUESTS_CHOICES = ['1', '2', '3', '4', '5', '6', '7'];

/**
 * How many days past its period end a subscription goes on when its renewal's
 * payment has failed (setting `subscriptions.graceDays`): from 0 to 7, 1
 * when unset. The processor retries the payment meanwhile; still unpaid
 * past these days, the subscription ends — however long the
 * processor would have gone on retrying.
 */
const GRACE_DAYS_MAX = 7;

export const GRACE_DAYS_DEFAULT = 1;

export const GRACE_DAYS_CHOICES = Array.from(
  { length: GRACE_DAYS_MAX + 1 },
  (_, i) => String(i)
);

export const MEDIA_TOOL_NAMES = [
  'generate_image',
  'edit_image',
  'generate_video',
  'edit_video',
  'text_to_speech'
] as const;

/**
 * Message parts that hold media: a file, or what a media tool made. The
 * Library reads by it and the index on `message` is built on it, so a tool
 * added above changes the index too, and the next migration rebuilds it.
 */
export const MEDIA_PARTS_JSONPATH = `$[*] ? (@.type == "file" || @.type like_regex "^tool-(${MEDIA_TOOL_NAMES.join('|')})$")`;

/** One page size for the whole console, tables and logs alike. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * The names the providers give their own web search tool. Shared by the
 * server, which registers them, and the usage count, which looks for them in
 * a finished step.
 */
export const PROVIDER_WEB_SEARCH_TOOL_NAMES: string[] = [
  'web_search',
  'google_search'
];

/**
 * 'auto' is a regular option value that admins put in a model's `uiOptions`
 * (e.g. `"aspectRatios": ["auto", "16:9"]`, default `"aspectRatio": "auto"`).
 * It flows through selection like any other value; only at the provider call
 * boundary does it resolve to "omit the parameter" via `resolveAutoOption`.
 */
export const AUTO_OPTION = 'auto';

export const CONTENT_TYPES = [
  { type: 'chat', label: 'New Chat', icon: MessageSquare, path: '/' },
  { type: 'library', label: 'Library', icon: LibraryBig, path: '/library' },
  { type: 'prompts', label: 'Prompts', icon: SquareSparkles, path: '/prompts' }
] as const;

/**
 * How hard a model may be asked to think. The AI SDK takes these as-is for
 * every provider behind it, so unlike the media fields there is nothing
 * per-provider to say. `'provider-default'` is not here: it is what an
 * unset effort resolves to, never something an admin lists.
 */
export const EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const;

export const CONSOLE_NAVIGATION = {
  navMain: [
    {
      title: 'Overview',
      url: '/console',
      icon: LayoutGrid
    },
    {
      title: 'Revenue',
      url: '/console/revenue',
      icon: ChartLine
    },
    {
      title: 'Usage',
      url: '/console/usage',
      icon: Logs
    },
    {
      title: 'Providers',
      url: '/console/providers',
      icon: Plug
    },
    {
      title: 'Models',
      url: '/console/models',
      icon: Cpu
    },
    {
      title: 'Pricing',
      url: '/console/pricing',
      icon: CircleDollarSign
    },
    {
      title: 'Prompts',
      url: '/console/prompts',
      icon: SquareSparkles
    },
    {
      title: 'Quotas',
      url: '/console/quotas',
      icon: Gauge
    },
    {
      title: 'Tiers',
      url: '/console/tiers',
      icon: Percent
    },
    {
      title: 'Plans',
      url: '/console/plans',
      icon: Package
    },
    {
      title: 'Subscriptions',
      url: '/console/subscriptions',
      icon: CalendarCheck
    },
    {
      title: 'Payments',
      url: '/console/payments',
      icon: CreditCard
    },
    {
      title: 'Refund requests',
      url: '/console/refund-requests',
      icon: Tickets
    },
    {
      title: 'Users',
      url: '/console/users',
      icon: Users
    },
    {
      title: 'Settings',
      url: '/console/settings',
      icon: Settings
    }
  ]
};

export const MEDIA_OPTION_LABELS: Record<MediaOptionKey, string> = {
  size: 'Size',
  aspectRatio: 'Aspect ratio',
  resolution: 'Resolution',
  duration: 'Duration',
  voice: 'Voice'
};

/**
 * How a server function says the session is gone.
 *
 * It refuses with a bare 401, and the browser's side of the call turns a bare
 * refusal into an `Error` carrying the body — so the body is the only thing
 * that crosses, and it is named here for both ends to agree on.
 */
export const UNAUTHORIZED = 'Unauthorized';

/**
 * What each kind of upload accepts, shared by the browser (which picks the
 * file) and the route that signs the token (which is what actually enforces
 * it — the browser's copy is a courtesy, not a control).
 *
 * Uploads go straight from the browser to blob storage: a Vercel function
 * cannot receive more than 4.5 MB of request body on any plan, which no video
 * and few audio files fit inside.
 */
export const UPLOAD_CONFIG = {
  avatar: {
    folder: 'avatars',
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024
  },
  attachment: {
    folder: 'attachments',
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      // Audio attachments feed the chat transcribe_audio (STT) tool.
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/x-m4a',
      'audio/ogg',
      'audio/webm',
      'audio/flac',
      // Video attachments feed the chat edit_video tool.
      'video/mp4',
      'video/quicktime',
      'video/webm'
    ],
    maxSize: 10 * 1024 * 1024,
    /** Video is the reason client uploads exist here; a clip needs the room. */
    videoMaxSize: 100 * 1024 * 1024
  },
  prompts: {
    folder: 'prompts',
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024
  }
} as const;

/**
 * What a reader is told when none of a model's providers answered.
 *
 * Addressed to the person looking at a chat, not to whoever runs the install:
 * which providers were tried and what each said goes to the log. Retrying is
 * worth a try — unlike a model that does not resolve at all, this one failed
 * in flight and may not next time.
 */
export const PROVIDER_FAILURE_MESSAGE =
  'This model is currently unavailable. Please try again or choose a different model.';

/**
 * A run of cells of slightly varied width, so a row does not read as a grid.
 * Shared with `ConsoleTableSkeleton`, which stands in the same way before the
 * table is mounted at all.
 *
 * Ceilings rather than widths, and paired with `w-full`. A bar of a fixed width
 * cannot shrink or wrap the way the text it stands in for does, so a wide table
 * of them sets a minimum width the real rows never ask for — and the page
 * scrolls sideways until the data lands and the cells start wrapping.
 */
export const CELL_WIDTHS = [
  'max-w-32',
  'max-w-24',
  'max-w-40',
  'max-w-20',
  'max-w-28',
  'max-w-16'
];
