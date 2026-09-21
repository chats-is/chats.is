import '@tanstack/react-start/server-only';

import { experimental_generateVideo as generateVideo } from 'ai';
import OpenAI, { AzureOpenAI } from 'openai';

import { type Model, type Provider, type ProviderConfig } from '@/types';
import { decrypt } from '@/lib/crypto';
import { uploadGeneratedMedia, type StoredMedia } from '@/lib/media-upload';
import {
  getVideoModel,
  isRetryableProviderError,
  runWithProviderFailover
} from '@/lib/provider';
import { toRequestParts } from '@/lib/provider-vocab';
import { resolveVideoSeconds } from '@/lib/video-usage';

/**
 * Raised when we stop waiting on a render — our own deadline, not a provider
 * fault. Distinct from a provider error because the two want opposite handling:
 * failing over to another provider restarts the render from zero and burns the
 * remaining request budget, and the user's fix is a shorter or smaller video
 * rather than a different model.
 */
/**
 * This provider cannot do what was asked — edit a video, start from an image —
 * though the model may well do it somewhere else. Nothing was sent and nothing
 * was charged, so the next provider is tried: a model bound to several is
 * bound to them for exactly this.
 */
export class ProviderCannotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderCannotError';
  }
}

export class VideoTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoTimeoutError';
  }
}

const POLL_INTERVAL_MS = 5000;

/**
 * How long we wait for a render before giving up, for every video path.
 *
 * Deliberately well inside the chat route's 300s budget: if a render is allowed
 * to run the whole budget, Vercel kills the function first and the request
 * 504s, which skips onFinish — the assistant message is never persisted and no
 * usage row is written, while the provider bills for the render anyway. Giving
 * up early loses slow renders, but the failure becomes a real tool result the
 * user can act on.
 */
const VIDEO_DEADLINE_MS = 150_000;

/** Sora polls on a fixed interval, so its ceiling is the deadline in ticks. */
const MAX_POLL_ATTEMPTS = VIDEO_DEADLINE_MS / POLL_INTERVAL_MS;

/**
 * A signal that aborts after `ms`. Built on an explicit timer rather than
 * `AbortSignal.timeout` so the caller can cancel it once the work finishes,
 * instead of leaving a live timer behind on every successful generation.
 */
function deadlineSignal(ms: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

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
        ? provider.apiOptions.apiVersion
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
export async function generateWithSora(args: {
  model: string;
  prompt: string;
  provider: ProviderConfig;
  /** Sora names its output by pixels; omitted where the model declares none. */
  size?: string;
  /** Required: the option chain settles this before anyone reaches a provider. */
  duration: number;
  abortSignal?: AbortSignal;
}): Promise<VideoGenerationResult> {
  const { model, prompt, provider, size, duration, abortSignal } = args;
  const openai = createOpenAIClient(provider);

  // Sora takes 4, 8 or 12; a request between them buys the next one up.
  const seconds: '4' | '8' | '12' =
    duration <= 4 ? '4' : duration <= 8 ? '8' : '12';

  // Create video generation request
  const created = await openai.videos.create(
    {
      model: model, // 'sora-2' | 'sora-2-pro'
      prompt,
      ...(size && { size: size as OpenAI.Videos.VideoSize }),
      seconds
    },
    { signal: abortSignal }
  );

  // Poll for completion if not already completed.
  let video: OpenAI.Videos.Video;
  try {
    video =
      created.status === 'completed'
        ? created
        : await pollSoraJob(openai, created.id, MAX_POLL_ATTEMPTS, abortSignal);
  } catch (err) {
    // Given up on — timed out, or stopped — but still rendering at the other
    // end, and a render that finishes is a render that is charged. Asked to
    // go, for what that is worth; the failure reported is the one above.
    try {
      // Bounded: the SDK would otherwise retry for up to ten minutes, holding
      // back the error this is on the way to reporting.
      await openai.videos.delete(created.id, {
        timeout: 10_000,
        maxRetries: 0
      });
    } catch {
      // Best effort. Nothing here may replace the error being reported.
    }
    throw err;
  }

  // Download video content using the SDK
  // Not given the signal. The render is finished by now and will be charged
  // for whatever happens next; stopping here would throw it away and leave no
  // usage row behind, which is the one outcome that costs and records nothing.
  const videoResponse = await openai.videos.downloadContent(video.id);
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

  // Bill what Sora says it made, not what we asked for: with no `seconds` sent
  // the length is Sora's to choose, and guessing it would bill the wrong clip.
  const generated = Number(video.seconds);

  return {
    buffer: videoBuffer,
    mediaType: 'video/mp4',
    seconds: Number.isFinite(generated) ? generated : Number(seconds)
  };
}

/**
 * Poll Sora job status until completion using OpenAI SDK
 */
async function pollSoraJob(
  openai: OpenAI,
  jobId: string,
  maxAttempts = MAX_POLL_ATTEMPTS,
  abortSignal?: AbortSignal
): Promise<OpenAI.Videos.Video> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    abortSignal?.throwIfAborted();

    // Retrieve video status
    const video = await openai.videos.retrieve(jobId, { signal: abortSignal });

    if (video.status === 'completed') {
      return video;
    } else if (video.status === 'failed') {
      throw new Error(
        `Sora video generation failed: ${video.error?.message || 'Unknown error'}`
      );
    }

    // Wait 5 seconds before next poll
    // A wait that a Stop can end, rather than one it has to sit out.
    await new Promise<void>((resolve, reject) => {
      const stopped = () => {
        clearTimeout(timer);
        reject(abortSignal?.reason ?? new Error('aborted'));
      };
      const timer = setTimeout(() => {
        abortSignal?.removeEventListener('abort', stopped);
        resolve();
      }, POLL_INTERVAL_MS);
      abortSignal?.addEventListener('abort', stopped, { once: true });
    });
  }

  throw new VideoTimeoutError(
    `Sora video generation timed out after ${(maxAttempts * POLL_INTERVAL_MS) / 1000}s`
  );
}

export type VideoGenerationOutput = StoredMedia & {
  videoSeconds?: number;
  provider: Provider;
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
  candidates: Provider[];
  /** For a model that names its output by pixels — Sora takes this, not a ratio. */
  size?: string;
  aspectRatio?: `${number}:${number}`;
  resolution?: string;
  /** Absent only when editing, where the source video's length stands. */
  duration?: number;
  /** Animate this image instead of generating from the text alone. */
  inputImage?: { data: Uint8Array; mediaType: string };
  /** Edit this video instead of generating a new one. */
  inputVideoUrl?: string;
  abortSignal?: AbortSignal;
}): Promise<VideoGenerationOutput> {
  const {
    userId,
    prompt,
    dbModel,
    candidates,
    inputImage,
    inputVideoUrl,
    abortSignal
  } = args;
  // Already settled by the pick* helpers against what the model declared.
  const { size, aspectRatio, resolution, duration } = args;
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
        if (inputVideoUrl) {
          throw new ProviderCannotError(
            `${dbModel.name} cannot edit a video; it generates from text only.`
          );
        }
        if (inputImage) {
          // The custom Sora path sends a prompt and nothing else, so an image
          // here would be dropped without a word — say so instead.
          throw new ProviderCannotError(
            `${dbModel.name} cannot animate an image; it generates from text only.`
          );
        }
        // Neither of the two cases that arrive without one, so the option
        // chain has settled a duration. Stated rather than assumed — the
        // alternative is a default down here, and defaults belong to the
        // chain, not to one provider's call.
        if (duration === undefined) {
          throw new Error(
            `${dbModel.name} needs a duration and none was settled.`
          );
        }
        const soraResult = await generateWithSora({
          model: modelId,
          prompt,
          provider,
          // Through the same catalogue as every other provider, even though
          // this call bypasses the AI SDK: a size Sora does not name is one
          // it would reject.
          size: toRequestParts(provider.type, 'video', { size }).top.size as
            string | undefined,
          duration,
          abortSignal
        });
        videoBuffer = soraResult.buffer;
        videoMediaType = soraResult.mediaType;
        // Sora returns no duration metadata — bill the bucketed duration the
        // request actually used (4/8/12s), not the raw client input.
        videoSeconds = soraResult.seconds;
      } else {
        // Editing a video is provider-specific: the AI SDK has no standard
        // parameter for it, and xAI takes the source as a URL in its own
        // namespace (which also makes it infer the edit mode). Refusing on
        // other providers beats sending the prompt alone and returning a new
        // video the user did not ask for.
        if (inputVideoUrl && provider.type !== 'xai') {
          throw new ProviderCannotError(
            `${dbModel.name} cannot edit a video through ${provider.type}.`
          );
        }

        // Duration, aspect ratio and resolution are inherited from the source
        // when editing, so the provider ignores them — don't send any.
        const parts = inputVideoUrl
          ? { top: {}, provider: {}, imageConfig: {} }
          : toRequestParts(provider.type, 'video', {
              aspectRatio,
              resolution,
              duration
            });

        const providerOpts = {
          ...provider.apiOptions,
          ...parts.provider,
          ...(inputVideoUrl && { videoUrl: inputVideoUrl })
        };
        // The AI SDK polls the provider internally with no ceiling of its
        // own, so the deadline has to be imposed from out here. Kept as its
        // own signal (rather than only the combined one) so the catch can tell
        // our deadline apart from the user cancelling the request.
        const deadline = deadlineSignal(VIDEO_DEADLINE_MS);
        const signal = abortSignal
          ? AbortSignal.any([abortSignal, deadline.signal])
          : deadline.signal;

        let video;
        let providerMetadata;
        try {
          ({ video, providerMetadata } = await generateVideo({
            model: getVideoModel(provider, modelId),
            // An image turns this into image-to-video: the picture is the
            // opening frame and the text says what happens from there.
            prompt: inputImage
              ? { image: inputImage.data, text: prompt }
              : prompt,
            ...parts.top,
            abortSignal: signal,
            ...(Object.keys(providerOpts).length > 0 && {
              providerOptions: {
                [provider.type]: providerOpts
              }
            })
          }));
        } catch (err) {
          if (deadline.signal.aborted && !abortSignal?.aborted) {
            throw new VideoTimeoutError(
              `${modelId} video generation timed out after ${VIDEO_DEADLINE_MS / 1000}s`
            );
          }
          throw err;
        } finally {
          deadline.cancel();
        }

        videoBuffer = Buffer.from(video.uint8Array);
        videoMediaType = 'video/mp4';
        // What is charged is what was asked of the provider, not what was
        // settled before the vocabulary had its say — a length the provider
        // was never sent is not one it rendered.
        videoSeconds = resolveVideoSeconds(
          providerMetadata,
          // Falls back to the settled length when none could be sent: an
          // estimate, but a per-second model charged for no seconds is free.
          parts.top.duration ?? duration
        );
      }

      return { videoBuffer, videoMediaType, videoSeconds };
    },
    {
      // Our own deadline is not a provider fault: the default classifier treats
      // any /timed out/ message as retryable, which would start a fresh render
      // on the next provider and spend the rest of the request budget on it.
      // Nor is a Stop. The OpenAI client reports one as an error of its own
      // that carries no name to tell it by, only a message reading "aborted" —
      // which the default classifier takes for a dropped connection.
      shouldRetry: error =>
        !abortSignal?.aborted &&
        (error instanceof ProviderCannotError ||
          (!(error instanceof VideoTimeoutError) &&
            isRetryableProviderError(error)))
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
