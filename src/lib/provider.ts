import '@tanstack/react-start/server-only';

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogle } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import {
  BedrockClient,
  ListFoundationModelsCommand
} from '@aws-sdk/client-bedrock';
import { GoogleGenAI } from '@google/genai';
import {
  APICallError,
  RetryError,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type TranscriptionModel
} from 'ai';

import {
  type Candidate,
  type Provider,
  type ProviderConfig,
  type ProviderType,
  type VertexServiceAccountKey
} from '@/types';

import { BedrockModels, VertexAIModels } from './constant';
import { decrypt } from './crypto';

function getProviderBaseUrl(provider: ProviderConfig) {
  if (provider.baseUrl) {
    return provider.baseUrl.replace(/\/+$/, '');
  }

  switch (provider.type) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'google':
      return 'https://generativelanguage.googleapis.com';
    case 'xai':
      return 'https://api.x.ai/v1';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'azure':
      throw new Error('Azure provider baseUrl is required to fetch models');
    case 'vertex':
      throw new Error('Vertex provider uses SDK model listing');
    case 'bedrock':
      return 'https://bedrock.us-east-1.amazonaws.com';
    default:
      throw new Error(`Unknown provider: ${provider.type}`);
  }
}

/**
 * Convert model ID to Vertex AI format if needed
 */
function toVertexModelId(modelId: string): string {
  return VertexAIModels[modelId] || modelId;
}

/**
 * Convert model ID to AWS Bedrock format if needed
 */
function toBedrockModelId(modelId: string): string {
  return BedrockModels[modelId] || modelId;
}

/**
 * Create provider SDK instance based on type and config
 */
function createProviderSDK(config: ProviderConfig): any {
  const { type, baseUrl } = config;
  const apiKey = config.apiKey ? decrypt(config.apiKey) : undefined;

  switch (type) {
    case 'openai':
      return createOpenAI({
        apiKey: apiKey || undefined,
        baseURL: baseUrl || undefined
      });

    case 'azure':
      return createAzure({
        apiKey: apiKey || undefined,
        baseURL: baseUrl ? baseUrl + '/openai/deployments' : undefined
      });

    case 'google':
      return createGoogle({
        apiKey: apiKey || undefined,
        baseURL: baseUrl || undefined
      });

    case 'vertex': {
      let vertexKey: VertexServiceAccountKey | null = null;

      if (apiKey) {
        try {
          vertexKey = JSON.parse(apiKey) as VertexServiceAccountKey;
        } catch {}
      }

      if (vertexKey?.location && vertexKey.credentials) {
        return createVertex({
          project: vertexKey.credentials.project_id,
          location: vertexKey.location,
          googleAuthOptions: {
            credentials: vertexKey.credentials
          }
        });
      }

      return createVertex({
        apiKey: apiKey || undefined
      });
    }

    case 'bedrock': {
      const bedrockKey = apiKey ? JSON.parse(apiKey) : undefined;

      return createAmazonBedrock({
        region: bedrockKey?.region || undefined,
        accessKeyId: bedrockKey?.accessKeyId || undefined,
        secretAccessKey: bedrockKey?.secretAccessKey || undefined,
        sessionToken: bedrockKey?.sessionToken || undefined
      });
    }

    case 'anthropic':
      return createAnthropic({
        apiKey: apiKey || undefined,
        baseURL: baseUrl || undefined
      });

    case 'xai':
      return createXai({
        apiKey: apiKey || undefined,
        baseURL: baseUrl || undefined
      });

    case 'deepseek':
      return createDeepSeek({
        apiKey: apiKey || undefined,
        baseURL: baseUrl || undefined
      });

    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}

/**
 * Get a language model by provider config and model ID
 */
export function getLanguageModel(
  provider: Candidate,
  modelId: string
): LanguageModel {
  const sdk = createProviderSDK(provider);
  return sdk(resolveModelId(provider, modelId));
}

/**
 * Get an image model by provider config and model ID
 */
export function getImageModel(
  provider: Candidate,
  modelId: string
): ImageModel {
  const sdk = createProviderSDK(provider);
  return sdk.image(resolveModelId(provider, modelId));
}

/**
 * Get a speech model by provider config and model ID
 */
export function getSpeechModel(
  provider: Candidate,
  modelId: string
): SpeechModel {
  const sdk = createProviderSDK(provider);
  return sdk.speech(resolveModelId(provider, modelId));
}

/**
 * Get a video model by provider config and model ID
 */
export function getVideoModel(provider: Candidate, modelId: string) {
  const sdk = createProviderSDK(provider);
  return sdk.video(resolveModelId(provider, modelId));
}

/**
 * Get a transcription (STT) model by provider config and model ID
 */
export function getTranscriptionModel(
  provider: Candidate,
  modelId: string
): TranscriptionModel {
  const sdk = createProviderSDK(provider);
  return sdk.transcription(resolveModelId(provider, modelId));
}

// ============================================================================
// Multi-provider failover
// ============================================================================

/**
 * The upstream model id a provider type actually receives for a logical modelId.
 * Vertex/Bedrock rename Anthropic models; everyone else uses modelId as-is.
 * Used to match a model against a provider's listed models (compatibility check).
 */
export function toProviderModelId(type: ProviderType, modelId: string): string {
  if (type === 'vertex') return toVertexModelId(modelId);
  if (type === 'bedrock') return toBedrockModelId(modelId);
  return modelId;
}

/**
 * The id to send this candidate for the model: the one its binding names,
 * if it names one, else the model's own — renamed for Vertex and Bedrock,
 * which list the same models under ids of their own.
 */
export function resolveModelId(candidate: Candidate, modelId: string): string {
  const routed = candidate.routedModelId?.trim();
  return routed || toProviderModelId(candidate.type, modelId);
}

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

export class AllProvidersFailedError extends Error {
  constructor(
    message: string,
    public readonly attempts: { provider: string; error: unknown }[]
  ) {
    super(message);
    this.name = 'AllProvidersFailedError';
  }
}

/**
 * Whether a provider error is worth failing over to the next provider.
 * Retryable: network/timeout, 404 (this provider doesn't serve the model),
 * 408/409/429, 5xx, and auth failures (401/403) — a misconfigured or
 * model-less provider shouldn't sink the whole request when another can serve.
 * Not retryable: other 4xx (bad request, content policy, context length),
 * where every provider would fail the same way.
 */
export function isRetryableProviderError(error: unknown): boolean {
  // The SDK retries 408/409/429/5xx itself, and what it throws once it gives
  // up is a RetryError wrapped around the last failure — no status of its
  // own. Read as it stands it matches nothing below, which made the errors
  // failover exists for the ones that never reached the next provider.
  if (RetryError.isInstance(error)) {
    if (error.reason === 'abort') return false;
    return isRetryableProviderError(error.lastError);
  }

  // Stopped on purpose. Its message says "aborted", which the pattern at the
  // bottom reads as a dropped connection — and failing over would start the
  // same paid render on the next provider, for someone who just asked for it
  // to stop.
  if (error instanceof Error && error.name === 'AbortError') return false;

  // HTTP status from either the AI SDK (APICallError.statusCode) or a raw SDK
  // error such as the openai client used by the Sora video path (error.status).
  const status =
    (APICallError.isInstance(error) ? error.statusCode : undefined) ??
    (typeof (error as { status?: unknown } | null)?.status === 'number'
      ? (error as { status: number }).status
      : undefined) ??
    (typeof (error as { statusCode?: unknown } | null)?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : undefined);

  if (typeof status === 'number') {
    if (status === 404 || status === 408 || status === 409 || status === 429)
      return true;
    if (status === 401 || status === 403) return true;
    return status >= 500;
  }

  // No status code: an AI SDK call error with no status is a network/connection
  // failure (worth trying another provider); otherwise fall back to the message.
  if (APICallError.isInstance(error)) return true;

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return /timeout|timed out|fetch failed|network|econn|socket|aborted/.test(
    message
  );
}

/**
 * Run `run` against each provider in priority order, failing over to the next
 * one on a retryable error. Resolves with the result and the provider that
 * actually succeeded (for usage attribution). Rethrows immediately on a
 * non-retryable error, and throws the last error once all providers fail.
 *
 * NOTE: for streaming responses the caller must only invoke this *before* any
 * bytes are written to the client — once streaming starts a provider cannot be
 * swapped without duplicating output.
 */
export async function runWithProviderFailover<T>(
  providers: Provider[],
  run: (provider: Provider) => Promise<T>,
  options?: { shouldRetry?: (error: unknown) => boolean }
): Promise<{ result: T; provider: Provider }> {
  const shouldRetry = options?.shouldRetry ?? isRetryableProviderError;
  const attempts: { provider: string; error: unknown }[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;
    try {
      const result = await run(provider);
      return { result, provider };
    } catch (error) {
      attempts.push({ provider: provider.name, error });
      if (isLast || !shouldRetry(error)) {
        throw error;
      }
    }
  }

  // Collected all the way down and read exactly here: without it the log says
  // only that everything failed, and the one thing worth knowing — which
  // provider said what — is gone.
  console.error(
    '[provider] every provider failed',
    attempts.map(
      attempt =>
        `${attempt.provider}: ${
          attempt.error instanceof Error
            ? attempt.error.message
            : String(attempt.error)
        }`
    )
  );
  throw new AllProvidersFailedError(PROVIDER_FAILURE_MESSAGE, attempts);
}

export async function getProviderModels(
  provider: ProviderConfig
): Promise<string[]> {
  if (!provider.apiKey) {
    throw new Error('Provider API key is required to fetch models');
  }

  const apiKey = decrypt(provider.apiKey);
  const baseUrl =
    provider.type === 'vertex' ? undefined : getProviderBaseUrl(provider);
  let response: Response;

  switch (provider.type) {
    case 'openai':
    case 'xai':
    case 'deepseek':
      response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      break;

    case 'anthropic':
      response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey ?? ''
        }
      });
      break;

    case 'google':
      response = await fetch(`${baseUrl}/v1beta/models?key=${apiKey}`);
      break;

    case 'azure':
      response = await fetch(
        `${baseUrl}/openai/deployments?api-version=2024-10-21`,
        {
          headers: {
            'api-key': apiKey ?? ''
          }
        }
      );
      break;

    case 'vertex': {
      let vertexKey: VertexServiceAccountKey | null = null;

      try {
        vertexKey = JSON.parse(apiKey) as VertexServiceAccountKey;
      } catch {}

      const ai =
        vertexKey?.location && vertexKey.credentials
          ? new GoogleGenAI({
              vertexai: true,
              project: vertexKey.credentials.project_id,
              location: vertexKey.location,
              googleAuthOptions: {
                credentials: vertexKey.credentials
              }
            })
          : new GoogleGenAI({
              vertexai: true,
              apiKey
            });
      const pager = await ai.models.list();
      const vertexModels: string[] = [];

      for await (const model of pager) {
        if (!model.name) continue;

        vertexModels.push(model.name.split('/').pop() ?? model.name);
      }

      return vertexModels;
    }

    case 'bedrock': {
      const credentials = JSON.parse(apiKey) as {
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        sessionToken?: string;
      };

      if (
        !credentials.region ||
        !credentials.accessKeyId ||
        !credentials.secretAccessKey
      ) {
        throw new Error(
          'Bedrock credentials must include region, accessKeyId, and secretAccessKey'
        );
      }

      const bedrockClient = new BedrockClient({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken
        },
        ...(provider.baseUrl && { endpoint: provider.baseUrl })
      });
      const data = await bedrockClient.send(
        new ListFoundationModelsCommand({})
      );

      return (
        data.modelSummaries
          ?.map(model => model.modelId)
          .filter((modelId): modelId is string => Boolean(modelId)) ?? []
      );
    }

    default:
      throw new Error(`Fetching models is not supported for ${provider.type}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch provider models: ${response.status}`);
  }

  const data = await response.json();
  const items =
    typeof data === 'object' && data !== null && 'data' in data
      ? (data as { data: unknown }).data
      : typeof data === 'object' && data !== null && 'models' in data
        ? (data as { models: unknown }).models
        : typeof data === 'object' && data !== null && 'value' in data
          ? (data as { value: unknown }).value
          : typeof data === 'object' &&
              data !== null &&
              'modelSummaries' in data
            ? (data as { modelSummaries: unknown }).modelSummaries
            : [];

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(item => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const id = record.id ?? record.name ?? record.model ?? record.modelId;

      if (typeof id !== 'string') {
        return null;
      }

      return id.replace(/^models\//, '');
    })
    .filter((modelId): modelId is string => modelId !== null);
}
