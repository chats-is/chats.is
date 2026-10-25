import '@tanstack/react-start/server-only';

import { APICallError, experimental_generateVideo as generateVideo } from 'ai';
import OpenAI, { AzureOpenAI } from 'openai';

import {
  type Candidate,
  type Model,
  type Provider,
  type ProviderConfig,
  type ProviderRequest,
  type ProviderType
} from '@/types';
import { decrypt } from '@/lib/crypto';
import { audioDurationInSeconds } from '@/lib/media-duration';
import { uploadGeneratedMedia, type StoredMedia } from '@/lib/media-upload';
import {
  getVideoModel,
  isRetryableProviderError,
  resolveModelId,
  runWithProviderFailover
} from '@/lib/provider';
import { providerRequestsOf } from '@/lib/provider-request';
import { sentResolution, toRequestParts } from '@/lib/provider-vocab';
import {
  extractVideoDurationSeconds,
  extractVideoTokens
} from '@/lib/video-usage';

/** The providers whose video models the AI SDK hands a last frame or
 *  reference images to: Google's and Vertex's Veo, and xAI's. */
const FRAME_AND_REFERENCE_PROVIDERS: readonly ProviderType[] = [
  'google',
  'vertex',
  'xai'
];

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
  /** The duration Sora says it generated (request is bucketed to 4/8/12s),
   *  where it says. */
  seconds: number | undefined;
  providerRequests: ProviderRequest[];
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
    seconds: Number.isFinite(generated) ? generated : undefined,
    // The job is the response; the request that made it, its own id.
    providerRequests: [
      {
        responseId: created.id,
        ...(created._request_id && { requestId: created._request_id })
      }
    ]
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

/** Gemini's API, where a provider names no address of its own — as the AI
 *  SDK's Google provider defaults. */
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

/** A picture or a clip as the Interactions API takes it, inline. */
const inlinePart = (
  type: 'image' | 'video',
  media: { data: Uint8Array; mediaType: string }
) => ({
  type,
  data: Buffer.from(media.data).toString('base64'),
  mime_type: media.mediaType
});

type OmniUsage = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  output_tokens_by_modality?: Array<{ modality?: string; tokens?: number }>;
};

export type OmniResult = {
  buffer: Buffer;
  mediaType: string;
  /** What it read — the prompt, and any picture or clip given. */
  inputTokens: number;
  /** The video, apart from any words it wrote. */
  videoTokens: number;
  outputTokens: number;
  /** What it thought before it drew, billed at the words' rate. */
  reasoningTokens: number;
  providerRequests: ProviderRequest[];
};

/**
 * Generate a video with Gemini Omni, through Google's Interactions API —
 * which the AI SDK does not reach: its Google video model calls Veo's
 * endpoint, and Omni answers on this one alone.
 *
 * One call, answered when the video is made, with the video inline. A picture
 * makes it image-to-video, reference pictures reference-to-video, and a clip
 * an edit of it. It takes no length: the model chooses one of three to ten
 * seconds, which the prompt may ask for. Billed by the tokens it reports, or
 * by the length of the video it makes.
 */
export async function generateWithOmni(args: {
  model: string;
  prompt: string;
  provider: ProviderConfig;
  resolution?: string;
  aspectRatio?: string;
  inputImage?: { data: Uint8Array; mediaType: string };
  referenceImages?: Array<{ data: Uint8Array; mediaType: string }>;
  inputVideo?: { data: Uint8Array; mediaType: string };
  abortSignal?: AbortSignal;
}): Promise<OmniResult> {
  const { model, prompt, provider, inputImage, referenceImages, inputVideo } =
    args;
  const media = [
    ...(inputVideo ? [inlinePart('video', inputVideo)] : []),
    ...(inputImage ? [inlinePart('image', inputImage)] : []),
    ...(referenceImages ?? []).map(image => inlinePart('image', image))
  ];
  const task = inputVideo
    ? 'edit'
    : referenceImages?.length
      ? 'reference_to_video'
      : inputImage
        ? 'image_to_video'
        : undefined;
  const url = `${provider.baseUrl || GEMINI_API}/interactions`;
  const body = {
    model,
    input: media.length ? [...media, { type: 'text', text: prompt }] : prompt,
    response_format: {
      type: 'video',
      ...(args.resolution && { resolution: args.resolution }),
      ...(args.aspectRatio && { aspect_ratio: args.aspectRatio })
    },
    ...(task && { generation_config: { video_config: { task } } }),
    // Answered in the one call, and kept nowhere at Google's end.
    store: false
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey && { 'x-goog-api-key': decrypt(provider.apiKey) })
    },
    body: JSON.stringify(body),
    signal: args.abortSignal
  });
  const text = await response.text();
  if (!response.ok) {
    // As the AI SDK reports a provider's refusal, so failover reads it alike.
    let message = text;
    try {
      message =
        (JSON.parse(text) as { error?: { message?: string } }).error?.message ??
        text;
    } catch {
      // Not JSON: the body as it came.
    }
    throw new APICallError({
      message,
      url,
      requestBodyValues: { model, task },
      statusCode: response.status,
      responseBody: text
    });
  }

  const result = JSON.parse(text) as {
    id?: string;
    usage?: OmniUsage;
    steps?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        data?: string;
        uri?: string;
        mime_type?: string;
      }>;
    }>;
  };
  const video = result.steps
    ?.flatMap(step => step.content ?? [])
    .find(part => part.type === 'video');
  let buffer: Buffer;
  if (video?.data) {
    buffer = Buffer.from(video.data, 'base64');
  } else if (video?.uri) {
    // A video too large to come inline comes as a file to fetch.
    const file = await fetch(video.uri, {
      headers: provider.apiKey
        ? { 'x-goog-api-key': decrypt(provider.apiKey) }
        : undefined
    });
    if (!file.ok) {
      throw new Error(`Gemini Omni video download failed: ${file.status}`);
    }
    buffer = Buffer.from(await file.arrayBuffer());
  } else {
    throw new Error('Gemini Omni returned no video');
  }

  const usage = result.usage ?? {};
  const videoTokens =
    usage.output_tokens_by_modality?.find(each => each.modality === 'video')
      ?.tokens ?? 0;
  return {
    buffer,
    mediaType: video.mime_type ?? 'video/mp4',
    inputTokens: usage.total_input_tokens ?? 0,
    videoTokens,
    outputTokens: Math.max((usage.total_output_tokens ?? 0) - videoTokens, 0),
    reasoningTokens: usage.total_thought_tokens ?? 0,
    providerRequests: result.id ? [{ responseId: result.id }] : []
  };
}

export type VideoGenerationOutput = StoredMedia & {
  videoSeconds?: number;
  /** The tokens the provider counted the clip as, where it says, and what
   *  it read, wrote and thought to make it. */
  videoTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** The size or resolution sent, which a rate per resolution is looked up
   *  by; none where the provider was sent neither, as for an edit. */
  resolution?: string;
  provider: Provider;
  providerRequests: ProviderRequest[];
};

/**
 * Generate a video with provider failover and upload it to Vercel Blob.
 * Shared by the standalone /api/video route and the chat `generate_video`
 * tool. Keeps the custom paths of Sora and Gemini Omni, which the AI SDK does
 * not reach, inside.
 */
export async function generateAndStoreVideo(args: {
  userId: string;
  prompt: string;
  dbModel: Model;
  candidates: Candidate[];
  /** For a model that names its output by pixels — Sora takes this, not a ratio. */
  size?: string;
  aspectRatio?: `${number}:${number}`;
  resolution?: string;
  /** Absent only when editing, where the source video's length stands. */
  duration?: number;
  /** Animate this image instead of generating from the text alone. */
  inputImage?: { data: Uint8Array; mediaType: string };
  /** With `inputImage`, the frame the video ends on. */
  lastImage?: { data: Uint8Array; mediaType: string };
  /** Images a new video draws on rather than starts from; never with a
   *  frame. */
  referenceImages?: Array<{ data: Uint8Array; mediaType: string }>;
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
    lastImage,
    referenceImages,
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
      // provider reports it, else read from the video itself.
      let videoSeconds: number | undefined;
      let videoTokens: number | undefined;
      let tokens:
        | Pick<OmniResult, 'inputTokens' | 'outputTokens' | 'reasoningTokens'>
        | undefined;
      let resolutionSent: string | undefined;
      let providerRequests: ProviderRequest[];

      // Sora has no AI SDK support yet — use the custom path. Azure exposes
      // video only through its OpenAI-compatible API (no AI SDK support
      // either), so it always takes this path regardless of deployment name.
      const providerModelId = resolveModelId(provider, modelId);
      if (providerModelId.includes('sora') || provider.type === 'azure') {
        if (inputVideoUrl) {
          throw new ProviderCannotError(
            `${dbModel.name} cannot edit a video; it generates from text only.`
          );
        }
        if (inputImage || referenceImages?.length) {
          // The custom Sora path sends a prompt and nothing else, so an image
          // here would be dropped without a word — say so instead.
          throw new ProviderCannotError(
            `${dbModel.name} cannot work from an image; it generates from text only.`
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
          model: providerModelId,
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
        // The length Sora says it made, else the video's own.
        videoSeconds =
          soraResult.seconds ??
          (await audioDurationInSeconds(videoBuffer, videoMediaType));
        resolutionSent = sentResolution(provider.type, 'video', { size });
        providerRequests = soraResult.providerRequests;
      } else if (
        provider.type === 'google' &&
        providerModelId.startsWith('gemini-omni')
      ) {
        if (lastImage) {
          throw new ProviderCannotError(
            `${dbModel.name} cannot end on a last frame; it starts from one.`
          );
        }
        // The clip to edit goes inline: it is one of ours, stored by us,
        // which Google cannot fetch for itself.
        let inputVideo: { data: Uint8Array; mediaType: string } | undefined;
        if (inputVideoUrl) {
          const source = await fetch(inputVideoUrl, { signal: abortSignal });
          if (!source.ok) {
            throw new Error(`Could not load the video: ${source.status}`);
          }
          inputVideo = {
            data: new Uint8Array(await source.arrayBuffer()),
            mediaType: source.headers.get('content-type') ?? 'video/mp4'
          };
        }
        // An edit keeps the source's shape, as for every provider.
        const parts = inputVideoUrl
          ? { top: {} as Record<string, string | number> }
          : toRequestParts(provider.type, 'video', { aspectRatio, resolution });

        const deadline = deadlineSignal(VIDEO_DEADLINE_MS);
        const signal = abortSignal
          ? AbortSignal.any([abortSignal, deadline.signal])
          : deadline.signal;
        let omni: OmniResult;
        try {
          omni = await generateWithOmni({
            model: providerModelId,
            prompt,
            provider,
            resolution: parts.top.resolution as string | undefined,
            aspectRatio: parts.top.aspectRatio as string | undefined,
            inputImage,
            referenceImages,
            inputVideo,
            abortSignal: signal
          });
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

        videoBuffer = omni.buffer;
        videoMediaType = omni.mediaType;
        // It takes no length and reports none: the length is read from the
        // video itself, as a transcription's is from the audio it heard.
        videoSeconds = await audioDurationInSeconds(
          omni.buffer,
          omni.mediaType
        );
        videoTokens = omni.videoTokens;
        tokens = omni;
        resolutionSent = inputVideoUrl
          ? undefined
          : sentResolution(provider.type, 'video', { resolution });
        providerRequests = omni.providerRequests;
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
        // A last frame and reference images are read only by the video
        // models of these; anywhere else the AI SDK drops them with a
        // warning, and the video would be one not asked for.
        if (
          (lastImage || referenceImages?.length) &&
          !FRAME_AND_REFERENCE_PROVIDERS.includes(provider.type)
        ) {
          throw new ProviderCannotError(
            `${dbModel.name} cannot take a last frame or reference images through ${provider.type}.`
          );
        }

        // xAI makes a video from reference images at 720p at most, and its
        // SDK lowers a 1080p asked for to 720p before sending, out of our
        // sight — lowered here instead, so the resolution sent is the one
        // billed.
        const asked =
          provider.type === 'xai' &&
          referenceImages?.length &&
          resolution === '1080p'
            ? '720p'
            : resolution;

        // Duration, aspect ratio and resolution are inherited from the source
        // when editing, so the provider ignores them — don't send any.
        const parts = inputVideoUrl
          ? { top: {}, provider: {}, imageConfig: {} }
          : toRequestParts(provider.type, 'video', {
              aspectRatio,
              resolution: asked,
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
        let responses;
        try {
          ({ video, providerMetadata, responses } = await generateVideo({
            model: getVideoModel(provider, modelId),
            // An image turns this into image-to-video: the picture is the
            // opening frame and the text says what happens from there. With
            // a last frame, both go as frames, and the text says how one
            // becomes the other.
            prompt:
              inputImage && !lastImage
                ? { image: inputImage.data, text: prompt }
                : prompt,
            ...(inputImage &&
              lastImage && {
                frameImages: [
                  { image: inputImage.data, frameType: 'first_frame' },
                  { image: lastImage.data, frameType: 'last_frame' }
                ]
              }),
            ...(referenceImages?.length && {
              inputReferences: referenceImages.map(image => ({
                data: image.data,
                mediaType: image.mediaType
              }))
            }),
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
        // The length the provider reports it made, else the video's own —
        // never one asked for, which it may not have rendered.
        videoSeconds =
          extractVideoDurationSeconds(providerMetadata) ??
          (await audioDurationInSeconds(videoBuffer, videoMediaType));
        videoTokens = extractVideoTokens(providerMetadata);
        resolutionSent = inputVideoUrl
          ? undefined
          : sentResolution(provider.type, 'video', { resolution: asked });
        providerRequests = providerRequestsOf(responses);
      }

      return {
        videoBuffer,
        videoMediaType,
        videoSeconds,
        videoTokens,
        inputTokens: tokens?.inputTokens,
        outputTokens: tokens?.outputTokens,
        reasoningTokens: tokens?.reasoningTokens,
        resolution: resolutionSent,
        providerRequests
      };
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
    videoTokens: result.videoTokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    reasoningTokens: result.reasoningTokens,
    resolution: result.resolution,
    provider: usedProvider,
    providerRequests: result.providerRequests
  };
}
