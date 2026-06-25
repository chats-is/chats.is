import 'server-only';

import { experimental_generateSpeech as generateSpeech } from 'ai';

import { Model } from '@/types';
import { resolveAutoOption } from '@/lib/media-options';
import { StoredMedia, uploadGeneratedMedia } from '@/lib/media-upload';
import {
  FailoverProvider,
  getSpeechModel,
  runWithProviderFailover
} from '@/lib/provider';

export type SpeechGenerationResult = StoredMedia & {
  characters: number;
  provider: FailoverProvider;
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
  candidates: FailoverProvider[];
  voice?: string;
  abortSignal?: AbortSignal;
}): Promise<SpeechGenerationResult> {
  const { userId, text, dbModel, candidates, abortSignal } = args;
  // 'auto' (admin-configurable option) means: let the provider decide.
  const voice = resolveAutoOption(args.voice);
  const modelId = dbModel.modelId;

  const { result: audio, provider: usedProvider } =
    await runWithProviderFailover(candidates, async provider => {
      const { audio } = await generateSpeech({
        model: getSpeechModel(provider, modelId),
        text,
        voice,
        outputFormat: 'mp3',
        abortSignal,
        ...(provider.apiOptions && {
          providerOptions: {
            [provider.type]: provider.apiOptions
          } as any
        })
      });
      return audio;
    });

  const stored = await uploadGeneratedMedia({
    userId,
    kind: 'generate-audios',
    buffer: Buffer.from(audio.base64, 'base64'),
    mediaType: audio.mediaType,
    ext: 'mp3'
  });

  return {
    ...stored,
    characters: text.length,
    provider: usedProvider
  };
}
