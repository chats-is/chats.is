import 'server-only';

import { transcribe } from 'ai';

import { Model } from '@/types';
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
  dbModel: Model;
  candidates: FailoverProvider[];
  abortSignal?: AbortSignal;
}): Promise<TranscriptionOutput> {
  const { audio, dbModel, candidates, abortSignal } = args;
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

  return { ...result, provider: usedProvider };
}
