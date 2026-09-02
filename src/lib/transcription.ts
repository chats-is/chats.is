import '@tanstack/react-start/server-only';

import { transcribe } from 'ai';

import { Model } from '@/types';
import { audioDurationInSeconds } from '@/lib/media-duration';
import {
  FailoverProvider,
  getTranscriptionModel,
  runWithProviderFailover
} from '@/lib/provider';

export type TranscriptionOutput = {
  text: string;
  durationInSeconds?: number;
  provider: FailoverProvider;
};

/**
 * Transcribe audio (STT) with provider failover. Returns plain text — nothing
 * is uploaded or persisted. Shared entry point for the chat `transcribe_audio`
 * tool (and any future standalone STT surface).
 */
export async function transcribeAudio(args: {
  audio: Uint8Array;
  /** The uploaded file's type, so the duration can be read from the bytes. */
  mediaType?: string;
  dbModel: Model;
  candidates: FailoverProvider[];
  abortSignal?: AbortSignal;
}): Promise<TranscriptionOutput> {
  const { audio, mediaType, dbModel, candidates, abortSignal } = args;
  const modelId = dbModel.modelId;

  const { result, provider: usedProvider } = await runWithProviderFailover(
    candidates,
    async provider => {
      const transcript = await transcribe({
        model: getTranscriptionModel(provider, modelId),
        audio,
        abortSignal,
        ...(provider.apiOptions && {
          providerOptions: {
            [provider.type]: provider.apiOptions
          } as any
        })
      });
      return {
        text: transcript.text,
        durationInSeconds: transcript.durationInSeconds
      };
    }
  );

  // Transcription bills per second, and whether a provider reports the length
  // it processed is up to that provider. The file is in hand either way, so
  // its own length stands in when none comes back.
  // Greater than zero, not merely present: a provider that answers 0 has told
  // us nothing, and billing per second would charge nothing for real work.
  const durationInSeconds =
    result.durationInSeconds && result.durationInSeconds > 0
      ? result.durationInSeconds
      : await audioDurationInSeconds(audio, mediaType);

  return { ...result, durationInSeconds, provider: usedProvider };
}
