import 'server-only';

import { tool, ToolSet } from 'ai';

import {
  ChatMessage,
  editImageInputSchema,
  generateImageInputSchema,
  generateVideoInputSchema,
  MediaToolOutput,
  Model,
  textToSpeechInputSchema,
  transcribeAudioInputSchema,
  TranscribeToolOutput
} from '@/types';
import {
  collectConversationMediaUrls,
  isTrustedMediaUrl
} from '@/lib/chat-media-urls';
import { buildMediaToolsSystemPrompt, ChatMediaToolName } from '@/lib/constant';
import { generateAndStoreImage } from '@/lib/image-generation';
import {
  AUTO_OPTION,
  pickAspectRatio,
  pickDuration,
  pickResolution,
  pickSize,
  pickVoice
} from '@/lib/media-options';
import { preflightCheck } from '@/lib/preflight';
import { bindingsToFailoverProviders, FailoverProvider } from '@/lib/provider';
import { findModelByModelId, getMediaDefaultModelIds } from '@/lib/queries';
import { generateAndStoreSpeech } from '@/lib/speech-generation';
import { transcribeAudio } from '@/lib/transcription';
import {
  recordAudioUsage,
  recordImageUsage,
  recordTranscriptionUsage,
  recordVideoUsage
} from '@/lib/usage';
import { isSttModel, isTtsModel } from '@/lib/utils';
import {
  generateAndStoreVideo,
  VideoTimeoutError
} from '@/lib/video-generation';

export type MediaToolsOptions = {
  image?: { modelId?: string; size?: string; aspectRatio?: string };
  /** Editing an existing image is its own model choice — few can do it. */
  imageEdit?: { modelId?: string };
  video?: {
    modelId?: string;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
  };
  /** Animating an image is its own model choice — few video models take one. */
  videoImage?: { modelId?: string };
  audio?: { modelId?: string; voice?: string };
  stt?: { modelId?: string };
};

type ResolvedMediaModel = {
  dbModel: Model;
  candidates: FailoverProvider[];
};

async function resolveMediaModel(
  modelId: string | null | undefined,
  capability: 'image' | 'video' | 'audio',
  accepts?: (model: Model) => boolean
): Promise<ResolvedMediaModel | null> {
  if (!modelId) return null;
  const dbModel = await findModelByModelId(modelId, capability);
  const candidates = bindingsToFailoverProviders(dbModel?.providers ?? []);
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
 * additionally requires the image model's `supportsEdit` flag.
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
  const [image, imageEdit, video, videoImage, audio, stt] = await Promise.all([
    resolveWithFallback(
      mediaOptions?.image?.modelId,
      defaults.imageModelId,
      'image'
    ),
    resolveWithFallback(
      mediaOptions?.imageEdit?.modelId,
      defaults.imageEditModelId,
      'image',
      model => !!model.supportsEdit
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
      model => !!model.supportsEdit
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
    if (!knownUrls.has(url) || !isTrustedMediaUrl(url)) {
      return {
        error: 'The URL must reference a file from this conversation.'
      };
    }
    try {
      const res = await fetch(url, { signal: abortSignal });
      if (!res.ok) {
        throw new Error(`Failed to fetch media: ${res.status}`);
      }
      const mediaType = res.headers.get('content-type') ?? '';
      if (!mediaType.startsWith(expectedTypePrefix)) {
        return {
          error: `The referenced file is not ${expectedTypePrefix === 'image/' ? 'an image' : 'an audio file'}.`
        };
      }
      return { data: new Uint8Array(await res.arrayBuffer()), mediaType };
    } catch (err) {
      console.error('[chat-tools] media fetch failed:', err);
      return {
        error: 'Could not load the referenced file. Please try again.'
      };
    }
  };

  const tools: ToolSet = {};
  const registered: ChatMediaToolName[] = [];

  const gate = async (
    dbModel: Model,
    capability: 'image' | 'video' | 'audio',
    opts?: { transcription?: boolean }
  ): Promise<{ status: 'error'; message: string } | null> => {
    const pre = await preflightCheck({
      userId,
      modelKey: dbModel.modelId,
      modelLabel: dbModel.name,
      capability,
      transcription: opts?.transcription
    });
    return pre.ok ? null : { status: 'error', message: pre.message };
  };

  if (image) {
    const { dbModel } = image;

    // Generating and editing may run on different models, so the work takes
    // the model it runs on rather than closing over the generator's.
    const runImage = async (
      on: ResolvedMediaModel,
      prompt: string,
      requested: { aspectRatio?: string; size?: string },
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

    tools.generate_image = tool({
      description:
        'Generate a new image from a text description.' +
        optionsHint('aspect ratios', dbModel.uiOptions?.aspectRatios) +
        optionsHint('sizes', dbModel.uiOptions?.sizes),
      inputSchema: generateImageInputSchema,
      execute: (input, { abortSignal }) =>
        runImage(
          image,
          input.prompt,
          { aspectRatio: input.aspectRatio, size: input.size },
          undefined,
          abortSignal
        )
    });
    registered.push('generate_image');

    // The editor is its own selection, falling back to the generator when that
    // one can edit too. Registered either way and refusing inside the tool when
    // there is no editor: leaving it out left the chat model with an editing
    // request and no way to serve it, so it improvised — one such request came
    // back as a hand-written SVG of what had been asked for, the user's own
    // image untouched and nothing said about the substitution.
    const editor = imageEdit ?? (dbModel.supportsEdit ? image : null);

    tools.edit_image = tool({
      description:
        'Edit an existing image from this conversation based on a text instruction.',
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
        (videoImage || dbModel.supportsEdit
          ? 'Generate a short video from a text description, optionally animating an image from this conversation.'
          : 'Generate a short video from a text description.') +
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
          const animator = videoImage ?? (dbModel.supportsEdit ? video : null);
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

  if (audio) {
    const { dbModel, candidates } = audio;

    tools.text_to_speech = tool({
      description:
        'Convert text to spoken audio (text-to-speech).' +
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
      description:
        'Transcribe an audio file from this conversation to text (speech-to-text).',
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
