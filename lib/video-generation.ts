import { experimental_generateVideo as generateVideo } from 'ai';
import OpenAI, { AzureOpenAI } from 'openai';

import type { Model, ProviderConfig } from '@/types';
import { decrypt } from '@/lib/crypto';
import { resolveAutoOption } from '@/lib/media-options';
import { StoredMedia, uploadGeneratedMedia } from '@/lib/media-upload';
import {
  FailoverProvider,
  getVideoModel,
  runWithProviderFailover
} from '@/lib/provider';
import { resolveVideoSeconds } from '@/lib/video-usage';

export type VideoGenerationResult = {
  buffer: Buffer;
  mediaType: string;
  /** The duration Sora actually generated (request is bucketed to 4/8/12s). */
  seconds: number;
};

/**
 * Create an OpenAI-compatible client for the Sora video API.
 *
 * Azure uses the `AzureOpenAI` client pointed at its OpenAI-compatible "v1"
 * surface (`apiVersion: 'preview'`), which exposes the same `videos.*` resource
 * as direct OpenAI — so the whole create/poll/download flow below is shared.
 */
function createOpenAIClient(provider: ProviderConfig): OpenAI {
  const apiKey = provider.apiKey ? decrypt(provider.apiKey) : undefined;

  if (provider.type === 'azure') {
    if (!provider.baseUrl) {
      throw new Error('Azure OpenAI Sora requires the provider endpoint URL');
    }
    // The video API is only available on Azure's next-gen v1 API surface,
    // which is selected by a 'preview' (or dated v1) api-version.
    const apiVersion =
      typeof provider.apiOptions?.apiVersion === 'string'
        ? (provider.apiOptions.apiVersion as string)
        : 'preview';
    return new AzureOpenAI({
      apiKey,
      endpoint: provider.baseUrl,
      apiVersion
    });
  }

  return new OpenAI({
    apiKey,
    baseURL: provider.baseUrl || undefined
  });
}

/**
 * Generate video using OpenAI Sora 2 API
 * Documentation: https://platform.openai.com/docs/guides/video-generation
 */
export async function generateWithSora(
  model: string,
  prompt: string,
  provider: ProviderConfig,
  aspectRatio?: `${number}:${number}`,
  resolution?: string,
  duration?: number,
  abortSignal?: AbortSignal
): Promise<VideoGenerationResult> {
  const openai = createOpenAIClient(provider);

  // Determine video size based on aspect ratio
  // Sora 2 supports: 720x1280, 1280x720, 1024x1792, 1792x1024
  const size = aspectRatio === '9:16' ? '720x1280' : '1280x720';

  // Determine duration in seconds (4, 8, or 12). This bucketed value is the
  // billable duration — the raw request may be shorter or absent.
  const seconds: '4' | '8' | '12' =
    duration && duration <= 4 ? '4' : duration && duration <= 8 ? '8' : '12';

  // Create video generation request
  const video = await openai.videos.create({
    model: model as any, // 'sora-2' | 'sora-2-pro'
    prompt,
    size: size as any,
    seconds,
    ...(resolution && { resolution: resolution as any })
  });

  // Poll for completion if not already completed
  if (video.status !== 'completed') {
    await pollSoraJob(openai, video.id, 60, abortSignal);
  }

  // Download video content using the SDK
  const videoResponse = await openai.videos.downloadContent(video.id);
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

  return {
    buffer: videoBuffer,
    mediaType: 'video/mp4',
    seconds: Number(seconds)
  };
}

/**
 * Poll Sora job status until completion using OpenAI SDK
 */
async function pollSoraJob(
  openai: OpenAI,
  jobId: string,
  maxAttempts = 60,
  abortSignal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    abortSignal?.throwIfAborted();

    // Retrieve video status
    const video = await openai.videos.retrieve(jobId);

    if (video.status === 'completed') {
      return;
    } else if (video.status === 'failed') {
      throw new Error(
        `Sora video generation failed: ${video.error?.message || 'Unknown error'}`
      );
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Sora video generation timed out after 5 minutes');
}

export type VideoGenerationOutput = StoredMedia & {
  videoSeconds?: number;
  provider: FailoverProvider;
};

/**
 * Generate a video with provider failover and upload it to Vercel Blob.
 * Shared by the standalone /api/video route and the chat `generate_video`
 * tool. Keeps the Sora custom path (no AI SDK support yet) inside.
 */
export async function generateAndStoreVideo(args: {
  userId: string;
  prompt: string;
  dbModel: Model;
  candidates: FailoverProvider[];
  aspectRatio?: `${number}:${number}`;
  resolution?: string;
  duration?: number;
  abortSignal?: AbortSignal;
}): Promise<VideoGenerationOutput> {
  const { userId, prompt, dbModel, candidates, duration, abortSignal } = args;
  // 'auto' (admin-configurable option) means: let the provider decide.
  const aspectRatio = resolveAutoOption(args.aspectRatio);
  const resolution = resolveAutoOption(args.resolution);
  const modelId = dbModel.modelId;

  const { result, provider: usedProvider } = await runWithProviderFailover(
    candidates,
    async provider => {
      let videoBuffer: Buffer;
      let videoMediaType: string;
      // Billable duration in seconds — actual generated length when the
      // provider reports it, else the requested duration.
      let videoSeconds: number | undefined;

      // Sora has no AI SDK support yet — use the custom path. Azure exposes
      // video only through its OpenAI-compatible API (no AI SDK support
      // either), so it always takes this path regardless of deployment name.
      if (modelId.includes('sora') || provider.type === 'azure') {
        const soraResult = await generateWithSora(
          modelId,
          prompt,
          provider,
          aspectRatio,
          resolution,
          duration,
          abortSignal
        );
        videoBuffer = soraResult.buffer;
        videoMediaType = soraResult.mediaType;
        // Sora returns no duration metadata — bill the bucketed duration the
        // request actually used (4/8/12s), not the raw client input.
        videoSeconds = soraResult.seconds;
      } else {
        const providerOpts = {
          ...provider.apiOptions,
          ...(resolution && { resolution })
        };
        const { video, providerMetadata } = await generateVideo({
          model: getVideoModel(provider, modelId),
          prompt,
          aspectRatio,
          duration,
          abortSignal,
          ...(Object.keys(providerOpts).length > 0 && {
            providerOptions: {
              [provider.type]: providerOpts
            } as any
          })
        });
        videoBuffer = Buffer.from(video.uint8Array);
        videoMediaType = 'video/mp4';
        videoSeconds = resolveVideoSeconds(providerMetadata, duration);
      }

      return { videoBuffer, videoMediaType, videoSeconds };
    }
  );

  const stored = await uploadGeneratedMedia({
    userId,
    kind: 'generate-videos',
    buffer: result.videoBuffer,
    mediaType: result.videoMediaType,
    ext: 'mp4'
  });

  return {
    ...stored,
    videoSeconds: result.videoSeconds,
    provider: usedProvider
  };
}
