import { z } from 'zod';

import { EFFORTS } from '@/lib/provider-vocab';

import { type ProviderType } from './provider';

/**
 * What a model is for — 'audio' covers both TTS and STT models, and
 * `supportsTranscription` distinguishes the direction.
 *
 * A schema rather than a bare union so the console form and the server
 * validate against the same list.
 */
export const modelCapabilitySchema = z.enum([
  'chat',
  'image',
  'video',
  'audio'
]);
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

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

// ============================================================================
// What the model server functions accept
// ============================================================================

const providerBindingSchema = z.object({
  providerId: z.string().min(1),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional()
});

const modelUIOptionsSchema = z
  .object({
    size: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    aspectRatio: z.string().optional(),
    aspectRatios: z.array(z.string()).optional(),
    duration: z.number().optional(),
    durations: z.array(z.number()).optional(),
    resolution: z.string().optional(),
    resolutions: z.array(z.string()).optional(),
    voice: z.string().optional(),
    voices: z.array(z.string()).optional(),
    // Effort is the one option every provider spells the same way, so
    // unlike its neighbours it can be checked against the list itself.
    effort: z.enum(EFFORTS).optional(),
    efforts: z.array(z.enum(EFFORTS)).optional(),
    reasoning: z.boolean().optional()
  })
  .strict();

const modelAPIParamsSchema = z
  .object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional()
  })
  .strict();

export const modelListSchema = z.object({
  capability: modelCapabilitySchema.optional(),
  providerId: z.string().optional()
});

export const modelCreateSchema = z.object({
  name: z.string().min(1).max(100),
  modelId: z.string().min(1).max(255),
  // Legacy single provider (still accepted); prefer `providers`.
  providerId: z.string().min(1).optional(),
  providers: z.array(providerBindingSchema).optional(),
  capability: modelCapabilitySchema,
  image: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  supportsVision: z.boolean().default(false),
  supportsReasoning: z.boolean().default(false),
  supportsImageEdit: z.boolean().default(false),
  supportsImageToVideo: z.boolean().default(false),
  supportsVideoEdit: z.boolean().default(false),
  supportsTranscription: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  uiOptions: modelUIOptionsSchema.optional(),
  apiParams: modelAPIParamsSchema.optional(),
  systemPrompt: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0)
});

export const modelUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  modelId: z.string().min(1).max(255).optional(),
  providerId: z.string().min(1).optional(),
  providers: z.array(providerBindingSchema).optional(),
  capability: modelCapabilitySchema.optional(),
  image: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  supportsVision: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  supportsImageEdit: z.boolean().optional(),
  supportsImageToVideo: z.boolean().optional(),
  supportsVideoEdit: z.boolean().optional(),
  supportsTranscription: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  uiOptions: modelUIOptionsSchema.nullable().optional(),
  apiParams: modelAPIParamsSchema.nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  displayOrder: z.number().int().optional()
});

export const modelIdSchema = z.object({ id: z.string().min(1) });
export const modelToggleSchema = z.object({
  id: z.string().min(1),
  isEnabled: z.boolean()
});

/** Addressing a model by its business key rather than its row id. */
export const modelRefSchema = z.object({ modelId: z.string().min(1) });

/** Which of a provider's models to bring into this install. */
export const modelSyncSchema = z.object({
  providerId: z.string().min(1),
  items: z
    .array(
      z.object({
        modelId: z.string().min(1).max(255),
        capability: modelCapabilitySchema
      })
    )
    .min(1)
});
