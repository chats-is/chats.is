import '@tanstack/react-start/server-only';

import { generateSpeech } from 'ai';

import {
  type Candidate,
  type Model,
  type Provider,
  type ProviderRequest
} from '@/types';
import { uploadGeneratedMedia, type StoredMedia } from '@/lib/media-upload';
import { modalityTokens } from '@/lib/modality-tokens';
import { getSpeechModel, runWithProviderFailover } from '@/lib/provider';
import { providerRequestsOf } from '@/lib/provider-request';
import { defaultVoice } from '@/lib/provider-vocab';

export type SpeechGenerationResult = StoredMedia & {
  characters: number;
  /** The words read and the audio spoken, in tokens, where the provider
   *  counts them (see `speechTokens`). */
  inputTokens?: number;
  audioOutputTokens?: number;
  provider: Provider;
  providerRequests: ProviderRequest[];
};

/** The file name a speech's type is stored under: mp3 asked for, and wav
 *  where a provider speaks only that, as Gemini does. */
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav'
};

/**
 * The tokens a speech took, where its provider counts them: Gemini, in the
 * `usageMetadata` of the answer the AI SDK hands back whole, the words it read
 * and the audio it spoke. OpenAI's speech answers with the audio alone.
 */
function speechTokens(body: unknown) {
  const usage = (body as { usageMetadata?: Record<string, unknown> } | null)
    ?.usageMetadata;
  if (!usage) return {};
  const count = (value: unknown) =>
    typeof value === 'number' ? value : undefined;
  return {
    inputTokens:
      modalityTokens(usage.promptTokensDetails, 'TEXT') ??
      count(usage.promptTokenCount),
    audioOutputTokens:
      modalityTokens(usage.candidatesTokensDetails, 'AUDIO') ??
      count(usage.candidatesTokenCount)
  };
}

/**
 * Generate speech (TTS) with provider failover and upload it to Vercel Blob.
 * Shared by the standalone /api/audio route and the chat `text_to_speech`
 * tool.
 */
export async function generateAndStoreSpeech(args: {
  userId: string;
  text: string;
  dbModel: Model;
  candidates: Candidate[];
  voice?: string;
  abortSignal?: AbortSignal;
}): Promise<SpeechGenerationResult> {
  const { userId, text, dbModel, candidates, abortSignal } = args;
  // Settled against what the model declared, or undefined when it declared
  // nothing — in which case the provider reached below supplies the fixed
  // fallback, since the three vendors share no voice name.
  const { voice } = args;
  const modelId = dbModel.modelId;

  const { result, provider: usedProvider } = await runWithProviderFailover(
    candidates,
    async provider => {
      const { audio, responses } = await generateSpeech({
        model: getSpeechModel(provider, modelId),
        text,
        voice: voice ?? defaultVoice(provider.type),
        outputFormat: 'mp3',
        abortSignal,
        ...(provider.apiOptions && {
          providerOptions: {
            [provider.type]: provider.apiOptions
          }
        })
      });
      return {
        audio,
        tokens: speechTokens(responses[0]?.body),
        providerRequests: providerRequestsOf(responses)
      };
    }
  );

  const stored = await uploadGeneratedMedia({
    userId,
    kind: 'generate-audios',
    buffer: Buffer.from(result.audio.base64, 'base64'),
    mediaType: result.audio.mediaType,
    ext: AUDIO_EXTENSIONS[result.audio.mediaType] ?? 'mp3'
  });

  return {
    ...stored,
    characters: text.length,
    ...result.tokens,
    provider: usedProvider,
    providerRequests: result.providerRequests
  };
}
