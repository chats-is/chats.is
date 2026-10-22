import '@tanstack/react-start/server-only';

import {
  parsePartialJson,
  tool,
  type InferUIMessageChunk,
  type ToolSet
} from 'ai';

import {
  createArtifactInputSchema,
  editImageInputSchema,
  editVideoInputSchema,
  generateImageInputSchema,
  generateVideoInputSchema,
  textToSpeechInputSchema,
  transcribeAudioInputSchema,
  updateArtifactInputSchema,
  type Artifact,
  type Candidate,
  type ChatMessage,
  type CreateArtifactInput,
  type MediaToolOutput,
  type MediaToolsOptions,
  type Model,
  type TranscribeToolOutput
} from '@/types';
import { type ChatMediaToolName } from '@/types/chat-tools';
import { artifactKindFromType, type ArtifactKind } from '@/lib/artifact';
import { collectConversationMediaUrls } from '@/lib/chat-media-urls';
import { AUTO_OPTION, MEDIA_TOOL_GUIDANCE } from '@/lib/constant';
import { generateAndStoreImage } from '@/lib/image-generation';
import {
  pickAspectRatio,
  pickDuration,
  pickResolution,
  pickSize,
  pickVoice
} from '@/lib/media-options';
import { allowsModel } from '@/lib/model-access';
import { resolveModelId } from '@/lib/provider';
import { generateAndStoreSpeech } from '@/lib/speech-generation';
import { transcribeAudio } from '@/lib/transcription';
import { generateUUID, isSttModel, isTtsModel } from '@/lib/utils';
import {
  generateAndStoreVideo,
  VideoTimeoutError
} from '@/lib/video-generation';
import {
  buildArtifact,
  editArtifact,
  getArtifact
} from '@/server/services/artifact';
import { isOwnBlobUrl } from '@/server/services/blob';
import {
  findModelByModelId,
  getAllModels,
  usableCandidates
} from '@/server/services/model';
import { preflightCheck } from '@/server/services/preflight';
import { getMediaDefaultModelIds } from '@/server/services/settings';
import { getUserTier } from '@/server/services/tier';
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
const MAX_MEDIA_CALLS_PER_TURN = 4;

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
  candidates: Candidate[];
};

async function resolveMediaModel(
  modelId: string | null | undefined,
  capability: 'image' | 'video' | 'audio',
  accepts?: (model: Model) => boolean
): Promise<ResolvedMediaModel | null> {
  if (!modelId) return null;
  const dbModel = await findModelByModelId(modelId, capability);
  const candidates = dbModel ? usableCandidates(dbModel) : [];
  if (!dbModel || candidates.length === 0) return null;
  if (accepts && !accepts(dbModel)) return null;
  return { dbModel, candidates };
}

/**
 * Resolve the user-selected model, falling back to the admin default when the
 * selection no longer resolves (model disabled/deleted, providers removed,
 * direction flag flipped, or kept from the user by their tier), and to the
 * first model of its kind that does when neither resolves — the order the
 * page falls back in, so the tool is offered with the model it shows. A stale
 * localStorage preference must not silently disable a tool another model
 * could still serve.
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
    const fallback = await resolveMediaModel(defaultId, capability, accepts);
    if (fallback) return fallback;
  }
  for (const dbModel of await getAllModels()) {
    if (dbModel.capability !== capability) continue;
    if (accepts && !accepts(dbModel)) continue;
    const candidates = usableCandidates(dbModel);
    if (candidates.length > 0) return { dbModel, candidates };
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

/** The rules that hold for every media tool; what each one is for is on the
 *  tool. Nothing when no media tool is registered. */
export function buildMediaToolsSystemPrompt(
  tools: ChatMediaToolName[]
): string {
  if (tools.length === 0) return '';
  const has = (...names: ChatMediaToolName[]) =>
    names.some(name => tools.includes(name));

  // Each part is said only when a tool it speaks of is there: a prompt that
  // talks of generated media with only transcription on offer has the model
  // looking for tools it was never given.
  const formats = has('generate_image', 'generate_video', 'text_to_speech');
  const producesMedia = has(
    'generate_image',
    'edit_image',
    'generate_video',
    'edit_video',
    'text_to_speech'
  );
  const transcribes = has('transcribe_audio');

  const handling = [
    producesMedia &&
      'The generated media renders automatically in the chat from the tool result — do NOT create an artifact for it, and do NOT print the raw URL or embed it in markdown. After the tool returns, add one short sentence describing the result.',
    transcribes &&
      'A transcript is not displayed, so write it out yourself — quote what was said, then answer whatever was asked about it.',
    'If the tool returns an error, nothing about it is shown to the user, so tell them yourself: one plain sentence saying what could not be done, and where there is an obvious next step (trying again, wording it differently, asking for a different kind of media) offer it. Say it in your own words — do not quote the error, name the media model that failed, or mention settings pages. Do not retry the tool on your own.'
  ]
    .filter(Boolean)
    .join(' ');

  return [
    'You also have media tools; each says what it is for.',
    formats &&
      "When the user's wording implies a format, map it to one of the values listed in the tool description (e.g. portrait/竖版 → 9:16, square → 1:1, HD/高清 → a higher resolution, a stated length → the closest duration) and pass it; otherwise omit those fields. What you pass is a suggestion for what the user did not settle: anything they chose in the app's own settings is used instead, and where neither says anything the model's first listed value applies.",
    handling
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Build the media generation tools for a chat request. Each tool is only
 * registered when its media model resolves (user selection from the request
 * body, falling back to the admin-configured system default) to one the
 * user's tier allows; `edit_image` additionally requires the image model's
 * `supportsImageEdit` flag.
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

  const [defaults, tier] = await Promise.all([
    getMediaDefaultModelIds(),
    getUserTier(userId)
  ]);
  // A model the user's tier refuses is none to offer a tool with: the page
  // shows them no such model, and every call would be refused.
  const allowed = (accepts?: (model: Model) => boolean) => (model: Model) =>
    allowsModel(tier, model.modelId) && (!accepts || accepts(model));
  const [image, imageEdit, video, videoImage, videoEdit, audio, stt] =
    await Promise.all([
      resolveWithFallback(
        mediaOptions?.image?.modelId,
        defaults.imageModelId,
        'image',
        allowed()
      ),
      resolveWithFallback(
        mediaOptions?.imageEdit?.modelId,
        defaults.imageEditModelId,
        'image',
        allowed(model => !!model.supportsImageEdit)
      ),
      resolveWithFallback(
        mediaOptions?.video?.modelId,
        defaults.videoModelId,
        'video',
        allowed()
      ),
      resolveWithFallback(
        mediaOptions?.videoImage?.modelId,
        defaults.videoImageModelId,
        'video',
        allowed(model => !!model.supportsImageToVideo)
      ),
      resolveWithFallback(
        mediaOptions?.videoEdit?.modelId,
        defaults.videoEditModelId,
        'video',
        allowed(model => !!model.supportsVideoEdit)
      ),
      resolveWithFallback(
        mediaOptions?.audio?.modelId,
        defaults.ttsModelId,
        'audio',
        allowed(isTtsModel)
      ),
      resolveWithFallback(
        mediaOptions?.stt?.modelId,
        defaults.sttModelId,
        'audio',
        allowed(isSttModel)
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
          providerModelId: resolveModelId(result.provider, dbModel.modelId),
          providerRequests: result.providerRequests,
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
          MEDIA_TOOL_GUIDANCE.generate_image +
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
      description: MEDIA_TOOL_GUIDANCE.edit_image,
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
          ? MEDIA_TOOL_GUIDANCE.generate_video
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
            providerModelId: resolveModelId(
              result.provider,
              on.dbModel.modelId
            ),
            providerRequests: result.providerRequests,
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
      description: MEDIA_TOOL_GUIDANCE.edit_video,
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
            providerModelId: resolveModelId(result.provider, dbModel.modelId),
            providerRequests: result.providerRequests,
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
        MEDIA_TOOL_GUIDANCE.text_to_speech +
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
            providerModelId: resolveModelId(result.provider, dbModel.modelId),
            providerRequests: result.providerRequests,
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
      description: MEDIA_TOOL_GUIDANCE.transcribe_audio,
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
            providerModelId: resolveModelId(result.provider, dbModel.modelId),
            providerRequests: result.providerRequests,
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

/** The artifact an update_artifact call names, once the id's closing quote
 *  is written: a partial parse would hand back an id cut short. */
const EDIT_TARGET = /"id"\s*:\s*"([^"\\]+)"/;

/**
 * The artifact tools for one reply, and what the reply keeps of them.
 *
 * `emit` writes a part the client reacts to but the message does not keep:
 * the deltas that draw an artifact on the canvas as it is written. What the
 * reply keeps is read from `kept` once it is over, and stored with it.
 */
export function buildArtifactTools(args: {
  userId: string;
  chatId: string;
  messageId: string;
  emit: (part: InferUIMessageChunk<ChatMessage>) => void;
}) {
  const { userId, chatId, messageId, emit } = args;

  const completedArtifacts = new Map<string, Artifact>();
  const completedArtifactOrder: string[] = [];
  // An earlier reply's artifact, by id, to the one this reply made of it.
  const replyCopies = new Map<string, string>();
  // The update_artifact call this reply is on; the next waits for it.
  let pendingEdit: Promise<unknown> = Promise.resolve();

  const emitArtifactDelta = (artifact: Artifact) => {
    emit({ type: 'data-id', data: artifact.id });
    const kind = artifactKindFromType(artifact.type);
    emit({
      type: 'data-title',
      data: { id: artifact.id, title: artifact.title }
    });
    emit({
      type: 'data-kind',
      data: {
        id: artifact.id,
        kind,
        artifactType: artifact.type
      }
    });
    emit({
      type: 'data-clear',
      data: { id: artifact.id }
    });
    if (['code', 'json', 'html'].includes(artifact.type)) {
      emit({
        type: 'data-codeDelta',
        data: {
          id: artifact.id,
          title: artifact.title,
          delta: artifact.content ?? '',
          mode: 'replace',
          language: artifact.language ?? undefined,
          artifactType: artifact.type
        }
      });
      emit({
        type: 'data-finish',
        data: { id: artifact.id }
      });
      return;
    }
    emit({
      type: 'data-textDelta',
      data: {
        id: artifact.id,
        title: artifact.title,
        delta: artifact.content ?? '',
        mode: 'replace',
        artifactType: artifact.type
      }
    });
    emit({
      type: 'data-finish',
      data: { id: artifact.id }
    });
  };

  type ToolArtifactStreamState = {
    artifactId: string;
    rawInput: string;
    started: boolean;
    lastTitle: string;
    lastKind: ArtifactKind;
    lastType?: CreateArtifactInput['type'];
    lastContent: string;
  };

  const toolArtifactStates = new Map<string, ToolArtifactStreamState>();

  // An update_artifact call being written, by its id, once the artifact it
  // names is written. A change arrives whole, when the call is; until then
  // the canvas is told which artifact is being changed, to show as it
  // stands, as source.
  //
  // A model may make its change in several calls, one after another — some
  // a step each, some failing. The canvas is shown the version each changes,
  // and stays on source for all of them: this reply's version is shown as
  // still being changed until the reply is over, when the canvas shows it
  // as a preview. Nothing is shown done before then — a call that failed is
  // often only the first try. The artifact a call names is told only once
  // the calls before it are done, so that a later one is shown the version
  // they made.
  const editStates = new Map<string, { rawInput: string; named?: string }>();

  // The version a change naming `id` is made to: this reply's, when the
  // reply made it or a copy of it, or else the one named.
  const editSource = async (id: string) => {
    const ownId = completedArtifacts.has(id) ? id : replyCopies.get(id);
    const source =
      (ownId && completedArtifacts.get(ownId)) ||
      (await getArtifact(userId, id));
    return { ownId, source };
  };

  // A call that showed its artifact on the canvas as it streamed, and
  // then failed — its input did not parse, or `execute` threw — leaves
  // nothing kept. Successful calls remove their own state, so what is
  // left when a step ends is exactly those, and the canvas is told to
  // drop them before the model's next step makes the artifact again.
  const discardUnfinished = () => {
    editStates.clear();
    for (const state of toolArtifactStates.values()) {
      if (state.started) {
        emit({
          type: 'data-discard',
          data: { id: state.artifactId }
        });
      }
    }
    toolArtifactStates.clear();
  };

  const emitToolArtifactUpdate = async (toolCallId: string) => {
    const state = toolArtifactStates.get(toolCallId);
    if (!state) return;

    const { value } = await parsePartialJson(state.rawInput);
    const input = (value ?? {}) as Partial<CreateArtifactInput>;
    const artifactType = input.type;
    if (!artifactType) return;
    const title = input.title?.trim() || 'Untitled';
    const kind = artifactKindFromType(artifactType);

    if (!state.started) {
      emit({ type: 'data-id', data: state.artifactId });
      emit({
        type: 'data-title',
        data: { id: state.artifactId, title }
      });
      emit({
        type: 'data-kind',
        data: {
          id: state.artifactId,
          kind,
          artifactType
        }
      });
      emit({
        type: 'data-clear',
        data: { id: state.artifactId }
      });
      state.started = true;
      state.lastTitle = title;
      state.lastKind = kind;
      state.lastType = artifactType;
    } else {
      if (title !== state.lastTitle) {
        emit({
          type: 'data-title',
          data: { id: state.artifactId, title }
        });
        state.lastTitle = title;
      }
      if (kind !== state.lastKind || artifactType !== state.lastType) {
        emit({
          type: 'data-kind',
          data: {
            id: state.artifactId,
            kind,
            artifactType
          }
        });
        state.lastKind = kind;
        state.lastType = artifactType;
      }
    }

    const nextContent = input.content ?? '';
    if (nextContent !== state.lastContent) {
      const isAppend = nextContent.startsWith(state.lastContent);
      const delta = isAppend
        ? nextContent.slice(state.lastContent.length)
        : nextContent;

      emit({
        type:
          kind === 'code' || kind === 'sheet'
            ? 'data-codeDelta'
            : 'data-textDelta',
        data: {
          id: state.artifactId,
          title,
          delta,
          mode: isAppend ? 'append' : 'replace',
          artifactType,
          ...(kind === 'code' || kind === 'sheet'
            ? {
                language:
                  artifactType === 'json'
                    ? 'json'
                    : (input.language ?? undefined)
              }
            : {})
        }
      });
      state.lastContent = nextContent;
    }
  };

  const tools = {
    create_artifact: tool({
      description:
        'Create a new artifact: code, a document (markdown, html or text), or a data table (json).',
      inputSchema: createArtifactInputSchema,
      onInputStart: ({ toolCallId }) => {
        toolArtifactStates.set(toolCallId, {
          artifactId: generateUUID(),
          rawInput: '',
          started: false,
          lastTitle: 'Untitled',
          lastKind: 'text',
          lastType: undefined,
          lastContent: ''
        });
      },
      onInputDelta: async ({ toolCallId, inputTextDelta }) => {
        const state = toolArtifactStates.get(toolCallId);
        if (!state) return;
        state.rawInput += inputTextDelta;
        await emitToolArtifactUpdate(toolCallId);
      },
      execute: async (input, options?: { toolCallId?: string }) => {
        const streamState = options?.toolCallId
          ? toolArtifactStates.get(options.toolCallId)
          : undefined;
        const artifact = buildArtifact(input, {
          id: streamState?.artifactId ?? generateUUID(),
          chatId,
          messageId
        });
        if (!completedArtifacts.has(artifact.id)) {
          completedArtifactOrder.push(artifact.id);
        }
        completedArtifacts.set(artifact.id, artifact);
        if (!streamState?.started) {
          emitArtifactDelta(artifact);
        } else {
          emit({
            type: 'data-finish',
            data: { id: artifact.id }
          });
        }
        emit({
          type: 'data-artifact',
          data: artifact
        });
        if (options?.toolCallId) {
          toolArtifactStates.delete(options.toolCallId);
        }

        return { id: artifact.id };
      }
    }),
    // A change to an artifact already in the chat — made this turn,
    // or by an earlier reply — written as only the passage that
    // changes. Not streamed onto the canvas as it is written: the
    // passages are short, and only the whole result means anything.
    //
    // A change is made to the version the call names. An earlier reply's
    // version is left as it was, and this reply gets its own copy; every
    // later change in this reply goes to that copy, whichever of the two ids
    // it names, so one change made in several calls is one version, not one
    // per call — calls made at once cannot know the id the others answer.
    // The SDK runs the calls of one step at once, so they are taken in turn:
    // each sees the copy the one before it made.
    update_artifact: tool({
      description:
        "Change part of one version of an artifact in this chat: replace oldStr, which must appear in it exactly once, with newStr. The id names the version the change starts from. Each change makes a new version, whose id the call returns; the version named stays as it was. Changes in one reply that name the same version build on one another, into that reply's one new version.",
      inputSchema: updateArtifactInputSchema,
      onInputStart: ({ toolCallId }) => {
        editStates.set(toolCallId, { rawInput: '' });
      },
      onInputDelta: ({ toolCallId, inputTextDelta }) => {
        const state = editStates.get(toolCallId);
        if (!state || state.named) return;
        state.rawInput += inputTextDelta;
        const named = EDIT_TARGET.exec(state.rawInput)?.[1];
        if (!named) return;
        state.named = named;
        void pendingEdit.then(async () => {
          if (!editStates.has(toolCallId)) return;
          const { source } = await editSource(named);
          emit({ type: 'data-editing', data: { id: source?.id ?? named } });
        });
      },
      execute: (input, options?: { toolCallId?: string }) => {
        const edit = pendingEdit.then(async () => {
          const { ownId, source } = await editSource(input.id);
          if (!source || source.chatId !== chatId) {
            throw new Error(`No artifact in this chat has id ${input.id}`);
          }
          const edited = editArtifact(source, input, {
            id: ownId ?? generateUUID(),
            chatId,
            messageId
          });
          const artifact = ownId
            ? { ...edited, createdAt: source.createdAt }
            : edited;
          if (!ownId) {
            completedArtifactOrder.push(artifact.id);
            replyCopies.set(input.id, artifact.id);
          }
          completedArtifacts.set(artifact.id, artifact);
          emitArtifactDelta(artifact);
          emit({
            type: 'data-artifact',
            data: artifact
          });
          emit({ type: 'data-editing', data: { id: artifact.id } });
          return { id: artifact.id };
        });
        pendingEdit = edit.catch(() => {});
        void edit
          .finally(() => {
            if (options?.toolCallId) editStates.delete(options.toolCallId);
          })
          .catch(() => {});
        return edit;
      }
    })
  };

  return {
    tools,
    discardUnfinished,
    /** What the reply keeps, in the order it was made. */
    kept: (): Artifact[] =>
      completedArtifactOrder
        .map(artifactId => completedArtifacts.get(artifactId))
        .filter((artifact): artifact is Artifact => Boolean(artifact))
  };
}
