import { NextResponse } from 'next/server';
import {
  experimental_generateSpeech as generateSpeech,
  NoSpeechGeneratedError
} from 'ai';

import { preflightGate } from '@/lib/preflight';
import {
  bindingsToFailoverProviders,
  getSpeechModel,
  runWithProviderFailover
} from '@/lib/provider';
import { findModelByModelId, getSpeechSettings } from '@/lib/queries';
import { recordAudioUsage } from '@/lib/usage';
import { getVerifiedSession } from '@/server/auth';

export const maxDuration = 60;

type PostData = {
  modelId?: string;
  text: string;
  voice?: string;
};

export async function POST(req: Request) {
  const session = await getVerifiedSession();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json: PostData = await req.json();
  const { modelId: requestModelId, text, voice: requestVoice } = json;

  if (!text) {
    return NextResponse.json(
      { error: 'Please enter some text.' },
      { status: 400 }
    );
  }

  // Get speech settings
  const { speechEnabled, defaultModel, defaultVoice } =
    await getSpeechSettings();
  if (!speechEnabled) {
    return NextResponse.json(
      { error: 'Speech is not enabled' },
      { status: 403 }
    );
  }

  // Use default values if not provided
  const modelId = requestModelId || defaultModel;
  const voice = requestVoice || defaultVoice;

  if (!modelId) {
    console.error('[speech] no model configured (no request model / default)');
    return NextResponse.json(
      { error: 'Text-to-speech is currently unavailable.' },
      { status: 400 }
    );
  }

  // Fetch model from database to validate
  const dbModel = await findModelByModelId(modelId, 'audio');
  const candidates = bindingsToFailoverProviders(dbModel?.providers ?? []);
  if (!dbModel || candidates.length === 0) {
    console.error(`[speech] model unavailable: ${modelId}`);
    return NextResponse.json(
      { error: 'Text-to-speech is currently unavailable.' },
      { status: 403 }
    );
  }

  // Validate voice against model's available voices
  const availableVoices = (dbModel.uiOptions?.voices as string[]) || [];
  if (voice && availableVoices.length > 0 && !availableVoices.includes(voice)) {
    return NextResponse.json(
      { error: 'The selected voice is not available.' },
      { status: 400 }
    );
  }

  const gate = await preflightGate({
    userId: session.user.id,
    modelKey: dbModel.modelId,
    modelLabel: dbModel.name,
    capability: 'audio',
    transcription: false
  });
  if (gate) return gate;

  try {
    const { result: audio, provider: usedProvider } =
      await runWithProviderFailover(candidates, async provider => {
        const { audio } = await generateSpeech({
          model: getSpeechModel(provider, modelId),
          text,
          voice,
          outputFormat: 'mp3',
          ...(provider.apiOptions && {
            providerOptions: {
              [provider.type]: provider.apiOptions
            } as any
          })
        });
        return audio;
      });

    await recordAudioUsage({
      userId: session.user.id,
      modelId,
      providerId: usedProvider.id,
      // TTS bills per input character (generateSpeech reports no token usage).
      audioCharacters: text.length
    });

    return NextResponse.json({
      type: 'audio',
      audio: `data:${audio.mediaType};base64,${audio.base64}`,
      mimeType: audio.mediaType
    });
  } catch (err) {
    console.error('Speech generation error:', err);
    if (NoSpeechGeneratedError.isInstance(err)) {
      return NextResponse.json(
        { error: 'No audio could be generated. Please try again.' },
        { status: 500 }
      );
    } else {
      return NextResponse.json(
        { error: 'Oops, an error occurred!' },
        { status: 500 }
      );
    }
  }
}
