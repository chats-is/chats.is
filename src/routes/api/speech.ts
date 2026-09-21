import { createFileRoute } from '@tanstack/react-router';
import { generateSpeech, NoSpeechGeneratedError } from 'ai';

import { type User } from '@/types';
import { speechRequestSchema } from '@/types/speech';
import { getSpeechModel, runWithProviderFailover } from '@/lib/provider';
import { authedRequest } from '@/server/middleware';
import { findModelByModelId } from '@/server/services/model';
import { preflightGate } from '@/server/services/preflight';
import { getSpeechSettings } from '@/server/services/settings';
import { recordAudioUsage } from '@/server/services/usage';

export const Route = createFileRoute('/api/speech')({
  server: {
    middleware: [authedRequest],
    handlers: { POST }
  }
});

async function POST({
  request: req,
  context
}: {
  request: Request;
  context: { user: User };
}) {
  const { user } = context;

  const parsed = speechRequestSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 }
    );
  }

  const { modelId: requestModelId, text, voice: requestVoice } = parsed.data;

  // Get speech settings
  const { speechEnabled, defaultModel } = await getSpeechSettings();
  if (!speechEnabled) {
    return Response.json({ error: 'Speech is not enabled' }, { status: 403 });
  }

  // Fall back to the admin's text-to-speech model; an unset voice lets the
  // provider use the model's own.
  const modelId = requestModelId || defaultModel;
  const voice = requestVoice || undefined;

  if (!modelId) {
    console.error('[speech] no model configured (no request model / default)');
    return Response.json(
      { error: 'Text-to-speech is currently unavailable.' },
      { status: 400 }
    );
  }

  // Fetch model from database to validate
  const dbModel = await findModelByModelId(modelId, 'audio');
  const candidates = dbModel?.providers.map(binding => binding.provider!) ?? [];
  if (!dbModel || candidates.length === 0) {
    console.error(`[speech] model unavailable: ${modelId}`);
    return Response.json(
      { error: 'Text-to-speech is currently unavailable.' },
      { status: 403 }
    );
  }

  // Validate voice against model's available voices
  const availableVoices = (dbModel.uiOptions?.voices as string[]) || [];
  if (voice && availableVoices.length > 0 && !availableVoices.includes(voice)) {
    return Response.json(
      { error: 'The selected voice is not available.' },
      { status: 400 }
    );
  }

  const gate = await preflightGate({
    userId: user.id,
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
            }
          })
        });
        return audio;
      });

    await recordAudioUsage({
      userId: user.id,
      modelId,
      providerId: usedProvider.id,
      // TTS bills per input character (generateSpeech reports no token usage).
      audioCharacters: text.length
    });

    return Response.json({
      type: 'audio',
      audio: `data:${audio.mediaType};base64,${audio.base64}`,
      mimeType: audio.mediaType
    });
  } catch (err) {
    console.error('Speech generation error:', err);
    if (NoSpeechGeneratedError.isInstance(err)) {
      return Response.json(
        { error: 'No audio could be generated. Please try again.' },
        { status: 500 }
      );
    } else {
      return Response.json(
        { error: 'Oops, an error occurred!' },
        { status: 500 }
      );
    }
  }
}
