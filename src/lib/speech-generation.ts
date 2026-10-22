import '@tanstack/react-start/server-only';

import { generateSpeech } from 'ai';

import {
  type Candidate,
  type Model,
  type Provider,
  type ProviderRequest
} from '@/types';
import { uploadGeneratedMedia, type StoredMedia } from '@/lib/media-upload';
import { getSpeechModel, runWithProviderFailover } from '@/lib/provider';
import { providerRequestsOf } from '@/lib/provider-request';
import { defaultVoice } from '@/lib/provider-vocab';

export type SpeechGenerationResult = StoredMedia & {
  characters: number;
  provider: Provider;
  providerRequests: ProviderRequest[];
};

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
      return { audio, providerRequests: providerRequestsOf(responses) };
    }
  );

  const stored = await uploadGeneratedMedia({
    userId,
    kind: 'generate-audios',
    buffer: Buffer.from(result.audio.base64, 'base64'),
    mediaType: result.audio.mediaType,
    ext: 'mp3'
  });

  return {
    ...stored,
    characters: text.length,
    provider: usedProvider,
    providerRequests: result.providerRequests
  };
}
