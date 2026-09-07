import { type ProviderType } from './provider';

// Model capability type ('audio' covers both TTS and STT models;
// `supportsTranscription` distinguishes the direction)
export type ModelCapability = 'chat' | 'image' | 'video' | 'audio';

// UI options for different model types
export type ModelUIOptions = {
  size?: string;
  sizes?: string[];
  aspectRatio?: string;
  aspectRatios?: string[];
  /** `'auto'` here means the same as it does for the others: send nothing. */
  duration?: number | 'auto';
  durations?: Array<number | 'auto'>;
  resolution?: string;
  resolutions?: string[];
  voice?: string;
  voices?: string[];
  /**
   * How hard the model should think. The values are the AI SDK's own — it
   * hands them to whichever provider is behind the model, so nothing here
   * translates them into one vendor's spelling.
   */
  effort?: ReasoningEffort;
  efforts?: ReasoningEffort[];
  /** Whether to show the thinking, not whether to do any. */
  reasoning?: boolean;
};

/**
 * What the AI SDK will take for `reasoning`, and hand to whichever provider
 * is behind the model. `'provider-default'` is its way of saying "you decide",
 * which is where an effort nobody pinned ends up.
 */
export type SentEffort =
  'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * What an admin lists and a user picks. No `'auto'` among them: a level is
 * either named or not chosen, and the chain already ends in the provider's
 * own default for the second case.
 */
export type ReasoningEffort = Exclude<SentEffort, 'provider-default'>;

// API parameters for model configuration
export type ModelAPIParams = {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
};

// Provider information from database
export type ModelProvider = {
  id: string;
  name: string;
  type: ProviderType;
  image?: string | null;
  isEnabled: boolean;
};

/**
 * A single model↔provider binding (row in `model_providers`). A model can have
 * several of these; the app tries them ordered by `priority` (ascending) and
 * fails over to the next enabled one on a retryable error.
 */
export type ModelProviderBinding = {
  id: string;
  modelId: string;
  providerId: string;
  priority: number;
  isEnabled: boolean;
  provider?: ModelProvider | null;
};

/**
 * Model type aligned with database schema
 * This is the unified model type used across the application
 */
export type Model = {
  // Database fields
  id: string;
  name: string;
  modelId: string;
  providerId: string;
  capability: ModelCapability;
  image?: string | null;
  aliases?: string[] | null;
  supportsVision?: boolean | null;
  supportsReasoning?: boolean | null;
  /** Image models: supports image editing (input images). */
  supportsImageEdit?: boolean | null;
  supportsImageToVideo?: boolean | null;
  supportsVideoEdit?: boolean | null;
  /** Audio models: STT (speech→text); unset means TTS. */
  supportsTranscription?: boolean | null;
  isEnabled: boolean;
  uiOptions?: ModelUIOptions | null;
  apiParams?: ModelAPIParams | null;
  /** Inline system prompt for chat models (replaces the old prompt-record FK). */
  systemPrompt?: string | null;
  displayOrder: number;
  /** @deprecated single-provider link; prefer `providers` (priority-ordered). */
  provider?: ModelProvider | null;
  /** Provider bindings ordered by priority (ascending). */
  providers?: ModelProviderBinding[] | null;
};
