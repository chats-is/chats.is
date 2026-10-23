import '@tanstack/react-start/server-only';

import { generateImage, generateText, type ModelMessage } from 'ai';

import {
  type Candidate,
  type Model,
  type Provider,
  type ProviderRequest,
  type ProviderType
} from '@/types';
import { TRANSPARENT_BACKGROUND_PROVIDERS } from '@/lib/constant';
import { uploadGeneratedMedia, type StoredMedia } from '@/lib/media-upload';
import {
  getImageModel,
  getLanguageModel,
  isRetryableProviderError,
  runWithProviderFailover
} from '@/lib/provider';
import { providerRequestsOf } from '@/lib/provider-request';
import { toRequestParts } from '@/lib/provider-vocab';
import { ProviderCannotError } from '@/lib/video-generation';

export type InputImage = {
  data: Uint8Array | string;
  mediaType: string;
};

/**
 * How a provider's image API is asked for a transparent background: OpenAI
 * and Azure as a PNG on one; Bedrock by its background-removal task, which
 * finds the subject itself and reads no prompt.
 */
const transparentOptions = (type: ProviderType) =>
  type === 'bedrock'
    ? { taskType: 'BACKGROUND_REMOVAL' }
    : { background: 'transparent', outputFormat: 'png' };

export type ImageGenerationResult = StoredMedia & {
  inputTokens?: number;
  outputTokens?: number;
  provider: Provider;
  providerRequests: ProviderRequest[];
};

/**
 * Generate an image (optionally editing input images) with provider failover
 * and upload it to Vercel Blob. Shared by the standalone /api/images route and
 * the chat `generate_image` / `edit_image` / `remove_background` tools.
 */
export async function generateAndStoreImage(args: {
  userId: string;
  prompt: string;
  dbModel: Model;
  candidates: Candidate[];
  size?: `${number}x${number}` | string;
  aspectRatio?: `${number}:${number}`;
  resolution?: string;
  inputImages?: InputImage[];
  /** On a transparent background, as a PNG. Only some providers' image APIs
   *  take one (`TRANSPARENT_BACKGROUND_PROVIDERS`); any other is passed
   *  over. */
  transparent?: boolean;
  abortSignal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  const {
    userId,
    prompt,
    dbModel,
    candidates,
    inputImages,
    transparent,
    abortSignal
  } = args;
  // Already settled: the `pick*` helpers chose from what the model declared,
  // so anything undefined here is a model that declared nothing — not an
  // 'auto' waiting to be unwrapped. Which of them a given provider can
  // actually take, and under what name, is `toRequestParts`' business.
  const { size, aspectRatio, resolution } = args;
  const modelId = dbModel.modelId;

  const { result, provider: usedProvider } = await runWithProviderFailover(
    candidates,
    async provider => {
      // Sent elsewhere, the image would come back on whatever background it
      // had, which is not what was asked for.
      if (
        transparent &&
        !TRANSPARENT_BACKGROUND_PROVIDERS.includes(provider.type)
      ) {
        throw new ProviderCannotError(
          `${dbModel.name} cannot make a transparent background through ${provider.type}.`
        );
      }
      // Gemini generates images inside a text turn and reads its settings
      // from a nested object; every other path uses the image API.
      const inline = provider.type === 'google' && modelId.startsWith('gemini');
      // Same settled values every time; where they land depends on which
      // provider this attempt reached, and by which call.
      const parts = toRequestParts(
        provider.type,
        'image',
        { size, aspectRatio, resolution },
        { inline }
      );

      let imageBase64: string;
      let imageMediaType: string;
      // Token counts for token-billed image models (e.g. gpt-image-1).
      // Undefined for per-image models — recordImageUsage falls back to
      // per-image pricing.
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let providerRequests: ProviderRequest[];

      // Gemini serves images via generateText (multi-modal); other providers
      // use the generateImage API.
      if (inline) {
        const messages: ModelMessage[] = [
          {
            role: 'user',
            content: [
              ...(inputImages ?? []).map(image => ({
                type: 'image' as const,
                image: image.data,
                mediaType: image.mediaType
              })),
              { type: 'text' as const, text: prompt }
            ]
          }
        ];

        const genResult = await generateText({
          model: getLanguageModel(provider, modelId),
          messages,
          temperature: dbModel.apiParams?.temperature,
          topP: dbModel.apiParams?.topP,
          topK: dbModel.apiParams?.topK,
          maxOutputTokens: dbModel.apiParams?.maxOutputTokens,
          frequencyPenalty: dbModel.apiParams?.frequencyPenalty,
          presencePenalty: dbModel.apiParams?.presencePenalty,
          abortSignal,
          providerOptions: {
            [provider.type]: {
              ...provider.apiOptions,
              imageConfig: parts.imageConfig
            }
          } as any
        });

        const imageFile = genResult.files?.find(f =>
          f.mediaType.startsWith('image/')
        );
        if (!imageFile) {
          throw new Error('No image generated by the model');
        }

        imageBase64 = imageFile.base64;
        imageMediaType = imageFile.mediaType;
        inputTokens = genResult.usage?.inputTokens;
        outputTokens = genResult.usage?.outputTokens;
        providerRequests = providerRequestsOf([genResult.response]);
      } else {
        // Standard image models use generateImage API
        const providerOpts = {
          ...provider.apiOptions,
          ...parts.provider,
          ...(transparent && transparentOptions(provider.type))
        };

        const { image, usage, responses } = await generateImage({
          model: getImageModel(provider, modelId),
          prompt: inputImages?.length
            ? { text: prompt, images: inputImages.map(image => image.data) }
            : prompt,
          n: 1,
          ...parts.top,
          abortSignal,
          ...(Object.keys(providerOpts).length > 0 && {
            providerOptions: {
              [provider.type]: providerOpts
            }
          })
        });

        imageBase64 = image.base64;
        imageMediaType = image.mediaType;
        inputTokens = usage?.inputTokens;
        outputTokens = usage?.outputTokens;
        providerRequests = providerRequestsOf(responses);
      }

      return {
        imageBase64,
        imageMediaType,
        inputTokens,
        outputTokens,
        providerRequests
      };
    },
    {
      shouldRetry: error =>
        error instanceof ProviderCannotError || isRetryableProviderError(error)
    }
  );

  const buffer = Buffer.from(result.imageBase64, 'base64');
  const ext = result.imageMediaType?.split('/')[1] || 'png';

  const stored = await uploadGeneratedMedia({
    userId,
    kind: 'generate-images',
    buffer,
    mediaType: result.imageMediaType,
    ext
  });

  return {
    ...stored,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    provider: usedProvider,
    providerRequests: result.providerRequests
  };
}
