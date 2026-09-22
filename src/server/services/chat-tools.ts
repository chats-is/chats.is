import '@tanstack/react-start/server-only';

import { tool, type ToolSet } from 'ai';

import {
  editImageInputSchema,
  editVideoInputSchema,
  generateImageInputSchema,
  generateVideoInputSchema,
  textToSpeechInputSchema,
  transcribeAudioInputSchema,
  type ChatMessage,
  type MediaToolOutput,
  type MediaToolsOptions,
  type Model,
  type Provider,
  type TranscribeToolOutput
} from '@/types';
import { collectConversationMediaUrls } from '@/lib/chat-media-urls';
import {
  buildMediaToolsSystemPrompt,
  MediaToolGuidance,
  type ChatMediaToolName
} from '@/lib/constant';
import { generateAndStoreImage } from '@/lib/image-generation';
import {
  AUTO_OPTION,
  pickAspectRatio,
  pickDuration,
  pickResolution,
  pickSize,
  pickVoice
} from '@/lib/media-options';
import { generateAndStoreSpeech } from '@/lib/speech-generation';
import { transcribeAudio } from '@/lib/transcription';
import { isSttModel, isTtsModel } from '@/lib/utils';
import {
  generateAndStoreVideo,
  VideoTimeoutError
} from '@/lib/video-generation';
import { isOwnBlobUrl } from '@/server/services/blob';
import { findModelByModelId } from '@/server/services/model';
import { preflightCheck } from '@/server/services/preflight';
import { getMediaDefaultModelIds } from '@/server/services/settings';
import {
  recordAudioUsage,
  recordImageUsage,
  recordTranscriptionUsage,
  recordVideoUsage
} from '@/server/services/usage';

/**
 * How many generations one reply may ask for.
 *
 * Each call is checked against the quota before it runs, but a call is only
 * charged when it finishes — and a model can ask for several at once, which
 * then all read the same balance and all pass. A video takes minutes, so that
 * is minutes in which any number of them would be let through. The count is
 * what is certain before anything has been charged, so it is what is limited.
 */
export const MAX_MEDIA_CALLS_PER_TURN = 4;

/** The most a tool will read of a file it was pointed at. */
const MAX_TOOL_MEDIA_BYTES = 25 * 1024 * 1024;

/** The body, or null once it has run past `limit` — a length header is only
 *  what the other end chose to say. */
async function readCapped(
  res: Response,
  limit: number
): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

type ResolvedMediaModel = {
  dbModel: Model;
  candidates: Provider[];
};

async function resolveMediaModel(
  modelId: string | null | undefined,
  capability: 'image' | 'video' | 'audio',
  accepts?: (model: Model) => boolean
): Promise<ResolvedMediaModel | null> {
  if (!modelId) return null;
  const dbModel = await findModelByModelId(modelId, capability);
  const candidates = dbModel?.providers.map(binding => binding.provider!) ?? [];
  if (!dbModel || candidates.length === 0) return null;
  if (accepts && !accepts(dbModel)) return null;
  return { dbModel, candidates };
}

/**
 * Resolve the user-selected model, falling back to the admin default when the
 * selection no longer resolves (model disabled/deleted, providers removed, or
 * direction flag flipped) — a stale localStorage preference must not silently
 * disable a tool the system default could still serve.
 */
async function resolveWithFallback(
  selectedId: string | null | undefined,
  defaultId: string | null | undefined,
  capability: 'image' | 'video' | 'audio',
  accepts?: (model: Model) => boolean
): Promise<ResolvedMediaModel | null> {
  const selected = await resolveMediaModel(selectedId, capability, accepts);
  if (selected) return selected;
  if (defaultId && defaultId !== selectedId) {
    return resolveMediaModel(defaultId, capability, accepts);
  }
  return null;
}

const GENERIC_TOOL_ERROR =
  'Generation failed. Please try again or pick a different model.';

/**
 * A render we stopped waiting on. Says what actually helps — picking another
 * model does not, since the deadline is ours and applies to every provider.
 */
const VIDEO_TIMEOUT_ERROR =
  'The video took too long to generate and was stopped. Try a shorter duration or a lower resolution.';

/**
 * Append the model's allowed option values to a tool description so the LLM
 * can map prompt wording (portrait, HD, 10 seconds, …) to a valid value.
 */
function optionsHint(
  label: string,
  values?: Array<string | number> | null
): string {
  const listed = values?.filter(value => value !== AUTO_OPTION);
  return listed?.length ? ` Available ${label}: ${listed.join(', ')}.` : '';
}

/**
 * Build the media generation tools for a chat request. Each tool is only
 * registered when its media model resolves (user selection from the request
 * body, falling back to the admin-configured system default); `edit_image`
 * additionally requires the image model's `supportsImageEdit` flag.
 *
 * Each call re-runs `preflightCheck` against its own media model and returns
 * a structured `{ status: 'error' }` output on any failure so the chat model
 * can relay it without breaking the stream. Usage is recorded against the
 * assistant message after a successful generation.
 */
export async function buildMediaTools(args: {
  userId: string;
  chatId: string;
  assistantMessageId: string;
  mediaOptions?: MediaToolsOptions;
  chatMessages: ChatMessage[];
}): Promise<{ tools: ToolSet; systemPrompt: string }> {
  const { userId, chatId, assistantMessageId, mediaOptions, chatMessages } =
    args;

  const defaults = await getMediaDefaultModelIds();
  const [image, imageEdit, video, videoImage, videoEdit, audio, stt] =
    await Promise.all([
      resolveWithFallback(
        mediaOptions?.image?.modelId,
        defaults.imageModelId,
        'image'
      ),
      resolveWithFallback(
        mediaOptions?.imageEdit?.modelId,
        defaults.imageEditModelId,
        'image',
        model => !!model.supportsImageEdit
      ),
      resolveWithFallback(
        mediaOptions?.video?.modelId,
        defaults.videoModelId,
        'video'
      ),
      resolveWithFallback(
        mediaOptions?.videoImage?.modelId,
        defaults.videoImageModelId,
        'video',
        model => !!model.supportsImageToVideo
      ),
      resolveWithFallback(
        mediaOptions?.videoEdit?.modelId,
        defaults.videoEditModelId,
        'video',
        model => !!model.supportsVideoEdit
      ),
      resolveWithFallback(
        mediaOptions?.audio?.modelId,
        defaults.ttsModelId,
        'audio',
        isTtsModel
      ),
      resolveWithFallback(
        mediaOptions?.stt?.modelId,
        defaults.sttModelId,
        'audio',
        isSttModel
      )
    ]);

  // URLs the model may reference: everything already in the conversation,
  // plus outputs generated by tools earlier in this same response (not yet
  // persisted into chatMessages).
  const knownUrls = collectConversationMediaUrls(chatMessages);

  /**
   * Allow-list + storage-origin check, then fetch the media bytes. The
   * conversation allow-list alone is not a trust boundary (user-message file
   * parts are persisted verbatim from the request body), so the URL must also
   * point at our own blob storage — this blocks SSRF against internal hosts.
   */
  const fetchKnownMedia = async (
    url: string,
    expectedTypePrefix: 'image/' | 'audio/',
    abortSignal: AbortSignal | undefined
  ): Promise<{ data: Uint8Array; mediaType: string } | { error: string }> => {
    if (!knownUrls.has(url) || !isOwnBlobUrl(url)) {
      return {
        error: 'The URL must reference a file from this conversation.'
      };
    }
    try {
      // Blob storage answers directly; a redirect would be a way out of the
      // host that was just checked.
      const res = await fetch(url, { signal: abortSignal, redirect: 'error' });
      if (!res.ok) {
        throw new Error(`Failed to fetch media: ${res.status}`);
      }
      // The whole file is held in memory to hand to a provider, none of which
      // takes more than this — so neither does the function.
      if (
        Number(res.headers.get('content-length') ?? 0) > MAX_TOOL_MEDIA_BYTES
      ) {
        // Refused, so not read — and a body nobody reads has to be let go of,
        // or the other end keeps sending it down a connection held open.
        await res.body?.cancel();
        return { error: 'The referenced file is too large.' };
      }
      const mediaType = res.headers.get('content-type') ?? '';
      if (!mediaType.startsWith(expectedTypePrefix)) {
        await res.body?.cancel();
        return {
          error: `The referenced file is not ${expectedTypePrefix === 'image/' ? 'an image' : 'an audio file'}.`
        };
      }
      const data = await readCapped(res, MAX_TOOL_MEDIA_BYTES);
      if (!data) return { error: 'The referenced file is too large.' };
      return { data, mediaType };
    } catch (err) {
      console.error('[chat-tools] media fetch failed:', err);
      return {
        error: 'Could not load the referenced file. Please try again.'
      };
    }
  };

  const tools: ToolSet = {};
  const registered: ChatMediaToolName[] = [];
  let mediaCalls = 0;

  const gate = async (
    dbModel: Model,
    capability: 'image' | 'video' | 'audio',
    opts?: { transcription?: boolean }
  ): Promise<{ status: 'error'; message: string } | null> => {
    // Counted before the check rather than after it passes: the calls of one
    // step arrive together, and would all be through the check before any of
    // them had been counted.
    //
    // Pictures and video, which are what cost. Reading a message aloud or
    // transcribing a clip is cheap and quick, and four transcriptions using
    // up a reply's allowance would refuse the one image it then asks for.
    if (capability !== 'audio' && ++mediaCalls > MAX_MEDIA_CALLS_PER_TURN) {
      return {
        status: 'error',
        message: `This reply has already made ${MAX_MEDIA_CALLS_PER_TURN} generations, which is the most one reply may make. Tell the user the rest can be asked for in a new message.`
      };
    }

    const pre = await preflightCheck({
      userId,
      modelKey: dbModel.modelId,
      modelLabel: dbModel.name,
      capability,
      transcription: opts?.transcription
    });
    return pre.ok ? null : { status: 'error', message: pre.message };
  };

  if (image || imageEdit) {
    // Generating and editing may run on different models, so the work takes
    // the model it runs on rather than closing over the generator's.
    const runImage = async (
      on: ResolvedMediaModel,
      prompt: string,
      requested: {
        aspectRatio?: string;
        size?: string;
        resolution?: string;
      },
      inputImages: Array<{ data: Uint8Array; mediaType: string }> | undefined,
      abortSignal: AbortSignal | undefined
    ): Promise<MediaToolOutput> => {
      const { dbModel, candidates } = on;
      const blocked = await gate(dbModel, 'image');
      if (blocked) return blocked;

      try {
        const result = await generateAndStoreImage({
          userId,
          prompt,
          dbModel,
          candidates,
          size: pickSize(
            requested.size,
            mediaOptions?.image?.size,
            dbModel.uiOptions
          ),
          aspectRatio: pickAspectRatio(
            requested.aspectRatio,
            mediaOptions?.image?.aspectRatio,
            dbModel.uiOptions
          ),
          resolution: pickResolution(
            requested.resolution,
            mediaOptions?.image?.resolution,
            dbModel.uiOptions
          ),
          inputImages,
          abortSignal
        });

        await recordImageUsage({
          userId,
          chatId,
          messageId: assistantMessageId,
          modelId: dbModel.modelId,
          providerId: result.provider.id,
          imageCount: 1,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens
        });

        knownUrls.add(result.url);
        return {
          status: 'done',
          url: result.url,
          mediaType: result.mediaType,
          filename: result.filename
        };
      } catch (err) {
        console.error('[chat-tools] image generation failed:', err);
        return { status: 'error', message: GENERIC_TOOL_ERROR };
      }
    };

    // Generating needs a generator; editing has its own model and can be the
    // only one configured, which is why this block is entered for either.
    if (image) {
      const { dbModel } = image;
      tools.generate_image = tool({
        description:
          MediaToolGuidance.generate_image +
          optionsHint('aspect ratios', dbModel.uiOptions?.aspectRatios) +
          optionsHint('sizes', dbModel.uiOptions?.sizes) +
          optionsHint('resolutions', dbModel.uiOptions?.resolutions),
        inputSchema: generateImageInputSchema,
        execute: (input, { abortSignal }) =>
          runImage(
            image,
            input.prompt,
            {
              aspectRatio: input.aspectRatio,
              size: input.size,
              resolution: input.resolution
            },
            undefined,
            abortSignal
          )
      });
      registered.push('generate_image');
    }

    // The editor is its own selection, falling back to the generator when that
    // one can edit too. Registered either way and refusing inside the tool when
    // there is no editor: leaving it out left the chat model with an editing
    // request and no way to serve it, so it improvised — one such request came
    // back as a hand-written SVG of what had been asked for, the user's own
    // image untouched and nothing said about the substitution.
    const editor =
      imageEdit ?? (image?.dbModel.supportsImageEdit ? image : null);

    tools.edit_image = tool({
      description: MediaToolGuidance.edit_image,
      inputSchema: editImageInputSchema,
      execute: async (input, { abortSignal }): Promise<MediaToolOutput> => {
        if (!editor) {
          return {
            status: 'error',
            message:
              'No image model that can edit is selected. Pick one under Advanced → Image editing.'
          };
        }

        const media = await fetchKnownMedia(
          input.imageUrl,
          'image/',
          abortSignal
        );
        if ('error' in media) {
          return { status: 'error', message: media.error };
        }
        return runImage(editor, input.prompt, {}, [media], abortSignal);
      }
    });
    registered.push('edit_image');
  }

  if (video) {
    const { dbModel } = video;

    tools.generate_video = tool({
      description:
        // No adjective for the length: the durations this model actually
        // offers follow in the next line, from what an admin configured, and a
        // description that says "short" beside a list ending in 60 contradicts
        // it.
        (videoImage || dbModel.supportsImageToVideo
          ? MediaToolGuidance.generate_video
          : 'Create a video from a text description.') +
        optionsHint('sizes', dbModel.uiOptions?.sizes) +
        optionsHint('aspect ratios', dbModel.uiOptions?.aspectRatios) +
        optionsHint('resolutions', dbModel.uiOptions?.resolutions) +
        optionsHint('durations (seconds)', dbModel.uiOptions?.durations),
      inputSchema: generateVideoInputSchema,
      execute: async (input, { abortSignal }): Promise<MediaToolOutput> => {
        // An image makes this image-to-video, which is its own model choice —
        // the animator when one is selected, else this model if it takes an
        // image too. Neither means the platform has none configured for it,
        // which is worth saying rather than generating from the words alone
        // and letting the user wonder where their picture went.
        let on = video;
        let inputImage;
        if (input.imageUrl) {
          const animator =
            videoImage ?? (dbModel.supportsImageToVideo ? video : null);
          if (!animator) {
            return {
              status: 'error',
              message:
                'No video model that can animate an image is selected. Pick one under Advanced → Video from image.'
            };
          }
          const media = await fetchKnownMedia(
            input.imageUrl,
            'image/',
            abortSignal
          );
          if ('error' in media) {
            return { status: 'error', message: media.error };
          }
          on = animator;
          inputImage = media;
        }

        // Gated on the model that will actually run, not the one selected for
        // text-to-video: pricing, the quota whitelist and the spend window are
        // all per model.
        const blocked = await gate(on.dbModel, 'video');
        if (blocked) return blocked;

        try {
          const result = await generateAndStoreVideo({
            userId,
            prompt: input.prompt,
            dbModel: on.dbModel,
            candidates: on.candidates,
            inputImage,
            size: pickSize(
              input.size,
              mediaOptions?.video?.size,
              on.dbModel.uiOptions
            ),
            aspectRatio: pickAspectRatio(
              input.aspectRatio,
              mediaOptions?.video?.aspectRatio,
              on.dbModel.uiOptions
            ),
            resolution: pickResolution(
              input.resolution,
              mediaOptions?.video?.resolution,
              on.dbModel.uiOptions
            ),
            duration: pickDuration(
              input.duration,
              mediaOptions?.video?.duration,
              on.dbModel.uiOptions
            ),
            abortSignal
          });

          await recordVideoUsage({
            userId,
            chatId,
            messageId: assistantMessageId,
            modelId: on.dbModel.modelId,
            providerId: result.provider.id,
            videoCount: 1,
            videoSeconds: result.videoSeconds
          });

          knownUrls.add(result.url);
          return {
            status: 'done',
            url: result.url,
            mediaType: result.mediaType,
            filename: result.filename
          };
        } catch (err) {
          console.error('[chat-tools] generate_video failed:', err);
          return {
            status: 'error',
            message:
              err instanceof VideoTimeoutError
                ? VIDEO_TIMEOUT_ERROR
                : GENERIC_TOOL_ERROR
          };
        }
      }
    });
    registered.push('generate_video');
  }

  if (videoEdit) {
    const { dbModel, candidates } = videoEdit;

    tools.edit_video = tool({
      description: MediaToolGuidance.edit_video,
      inputSchema: editVideoInputSchema,
      execute: async (input, { abortSignal }): Promise<MediaToolOutput> => {
        // The provider fetches the source itself, so this checks the URL
        // rather than downloading it: the same two conditions the media fetch
        // applies — present in this conversation, and stored by us.
        if (!knownUrls.has(input.videoUrl) || !isOwnBlobUrl(input.videoUrl)) {
          return {
            status: 'error',
            message: 'That video is not part of this conversation.'
          };
        }

        // And that it is a video: an image URL from the same conversation
        // passes the checks above and would come back as an opaque provider
        // failure. A HEAD keeps this to a header read — the provider fetches
        // the file itself.
        try {
          const head = await fetch(input.videoUrl, {
            method: 'HEAD',
            signal: abortSignal
          });
          if (!head.headers.get('content-type')?.startsWith('video/')) {
            return {
              status: 'error',
              message: 'That file is not a video.'
            };
          }
        } catch (err) {
          console.error('[chat-tools] video head request failed:', err);
          return {
            status: 'error',
            message: 'Could not load the referenced video. Please try again.'
          };
        }

        const blocked = await gate(dbModel, 'video');
        if (blocked) return blocked;

        try {
          const result = await generateAndStoreVideo({
            userId,
            prompt: input.prompt,
            dbModel,
            candidates,
            inputVideoUrl: input.videoUrl,
            abortSignal
          });

          await recordVideoUsage({
            userId,
            chatId,
            messageId: assistantMessageId,
            modelId: dbModel.modelId,
            providerId: result.provider.id,
            videoCount: 1,
            videoSeconds: result.videoSeconds
          });

          knownUrls.add(result.url);
          return {
            status: 'done',
            url: result.url,
            mediaType: result.mediaType,
            filename: result.filename
          };
        } catch (err) {
          console.error('[chat-tools] edit_video failed:', err);
          return {
            status: 'error',
            message:
              err instanceof VideoTimeoutError
                ? VIDEO_TIMEOUT_ERROR
                : GENERIC_TOOL_ERROR
          };
        }
      }
    });
    registered.push('edit_video');
  }

  if (audio) {
    const { dbModel, candidates } = audio;

    tools.text_to_speech = tool({
      description:
        MediaToolGuidance.text_to_speech +
        optionsHint('voices', dbModel.uiOptions?.voices),
      inputSchema: textToSpeechInputSchema,
      execute: async (input, { abortSignal }): Promise<MediaToolOutput> => {
        const blocked = await gate(dbModel, 'audio', { transcription: false });
        if (blocked) return blocked;

        try {
          const result = await generateAndStoreSpeech({
            userId,
            text: input.text,
            dbModel,
            candidates,
            voice: pickVoice(
              input.voice,
              mediaOptions?.audio?.voice,
              dbModel.uiOptions
            ),
            abortSignal
          });

          await recordAudioUsage({
            userId,
            chatId,
            messageId: assistantMessageId,
            modelId: dbModel.modelId,
            providerId: result.provider.id,
            // TTS bills per input character (generateSpeech reports no
            // token usage).
            audioCharacters: result.characters
          });

          // Same-response transcribe_audio may reference this output.
          knownUrls.add(result.url);
          return {
            status: 'done',
            url: result.url,
            mediaType: result.mediaType,
            filename: result.filename
          };
        } catch (err) {
          console.error('[chat-tools] text_to_speech failed:', err);
          return { status: 'error', message: GENERIC_TOOL_ERROR };
        }
      }
    });
    registered.push('text_to_speech');
  }

  if (stt) {
    const { dbModel, candidates } = stt;

    tools.transcribe_audio = tool({
      description: MediaToolGuidance.transcribe_audio,
      inputSchema: transcribeAudioInputSchema,
      execute: async (
        input,
        { abortSignal }
      ): Promise<TranscribeToolOutput> => {
        const blocked = await gate(dbModel, 'audio', { transcription: true });
        if (blocked) return blocked;

        const media = await fetchKnownMedia(
          input.audioUrl,
          'audio/',
          abortSignal
        );
        if ('error' in media) {
          return { status: 'error', message: media.error };
        }

        try {
          const result = await transcribeAudio({
            audio: media.data,
            mediaType: media.mediaType,
            dbModel,
            candidates,
            abortSignal
          });

          await recordTranscriptionUsage({
            userId,
            chatId,
            messageId: assistantMessageId,
            modelId: dbModel.modelId,
            providerId: result.provider.id,
            audioSeconds: result.durationInSeconds
          });

          return {
            status: 'done',
            text: result.text,
            durationInSeconds: result.durationInSeconds
          };
        } catch (err) {
          console.error('[chat-tools] transcribe_audio failed:', err);
          return { status: 'error', message: GENERIC_TOOL_ERROR };
        }
      }
    });
    registered.push('transcribe_audio');
  }

  return { tools, systemPrompt: buildMediaToolsSystemPrompt(registered) };
}
