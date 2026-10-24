import '@tanstack/react-start/server-only';

import { transcribe } from 'ai';

import {
  type Candidate,
  type Model,
  type Provider,
  type ProviderRequest
} from '@/types';
import { audioDurationInSeconds } from '@/lib/media-duration';
import { getTranscriptionModel, runWithProviderFailover } from '@/lib/provider';
import { providerRequestsOf } from '@/lib/provider-request';

export type TranscriptionOutput = {
  text: string;
  durationInSeconds?: number;
  /** The audio heard, any words given with it, and the words written, in
   *  tokens, where the provider counts them (see `transcriptTokens`). */
  audioInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  provider: Provider;
  providerRequests: ProviderRequest[];
};

/**
 * The tokens a transcription took, where its provider counts them: OpenAI's
 * token-priced models, in the `usage` of the answer the AI SDK hands back
 * whole, the audio heard and the words written. A model priced by length
 * answers with its seconds instead, and is billed by those.
 */
function transcriptTokens(body: unknown) {
  const usage = (
    body as {
      usage?: {
        type?: string;
        input_tokens?: number;
        input_token_details?: { audio_tokens?: number; text_tokens?: number };
        output_tokens?: number;
      };
    } | null
  )?.usage;
  if (usage?.type !== 'tokens') return {};
  return {
    audioInputTokens:
      usage.input_token_details?.audio_tokens ?? usage.input_tokens,
    inputTokens: usage.input_token_details?.text_tokens,
    outputTokens: usage.output_tokens
  };
}

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
  candidates: Candidate[];
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
          }
        })
      });
      return {
        text: transcript.text,
        durationInSeconds: transcript.durationInSeconds,
        // The answer is handed back whole, though the SDK's type for a
        // transcription's response leaves it out.
        ...transcriptTokens(
          (transcript.responses[0] as { body?: unknown } | undefined)?.body
        ),
        providerRequests: providerRequestsOf(transcript.responses)
      };
    }
  );

  // Transcription bills by length, and whether a provider reports the length
  // it processed is up to that provider. The file is in hand either way, so
  // its own length stands in when none comes back.
  // Greater than zero, not merely present: a provider that answers 0 has told
  // us nothing, and billing by length would charge nothing for real work.
  const durationInSeconds =
    result.durationInSeconds && result.durationInSeconds > 0
      ? result.durationInSeconds
      : await audioDurationInSeconds(audio, mediaType);

  return { ...result, durationInSeconds, provider: usedProvider };
}
