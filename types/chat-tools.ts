import { z } from 'zod';

import { artifactTypeSchema } from './artifact';

// Zod input schemas for the chat tools (create_artifact + media generation).
// Shared by the server (streamText tool definitions) and the client (tool
// part type narrowing via ChatTools).

export const createArtifactInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  type: artifactTypeSchema,
  language: z.string().optional(),
  content: z.string().optional(),
  fileUrl: z.url().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional()
});

export type CreateArtifactInput = z.infer<typeof createArtifactInputSchema>;

export const generateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('A detailed description of the image to generate'),
  aspectRatio: z
    .string()
    .optional()
    .describe(
      'Aspect ratio like "16:9" — pick from the available values when the user\'s wording implies a format (e.g. portrait/竖版 → 9:16, square → 1:1); omit otherwise'
    ),
  size: z
    .string()
    .optional()
    .describe(
      'Image size like "1024x1024" — pick from the available values when the user\'s wording implies one; omit otherwise'
    )
});

export const editImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('A detailed description of what to change in the image'),
  imageUrl: z
    .url()
    .describe(
      'URL of an image from this conversation (a user upload or a previously generated image)'
    )
});

export const generateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('A detailed description of the video to generate'),
  aspectRatio: z
    .string()
    .optional()
    .describe(
      'Aspect ratio like "16:9" — pick from the available values when the user\'s wording implies a format (e.g. portrait/竖版 → 9:16); omit otherwise'
    ),
  resolution: z
    .string()
    .optional()
    .describe(
      'Resolution like "1080p" — pick from the available values when the user\'s wording implies one (e.g. 高清); omit otherwise'
    ),
  duration: z
    .number()
    .optional()
    .describe(
      "Duration in seconds — pick the closest available value when the user's wording implies a length; omit otherwise"
    )
});

export const textToSpeechInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe('The exact text to convert to speech, with nothing else'),
  voice: z
    .string()
    .optional()
    .describe(
      "Voice name — pick from the available values when the user's wording implies a voice style; omit otherwise"
    )
});

export const transcribeAudioInputSchema = z.object({
  audioUrl: z
    .url()
    .describe(
      'URL of an audio file from this conversation (a user upload or previously generated audio)'
    )
});

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;
export type EditImageInput = z.infer<typeof editImageInputSchema>;
export type GenerateVideoInput = z.infer<typeof generateVideoInputSchema>;
export type TextToSpeechInput = z.infer<typeof textToSpeechInputSchema>;
export type TranscribeAudioInput = z.infer<typeof transcribeAudioInputSchema>;

/**
 * The failure half of every media tool result, and the shape anything else that
 * reports a failure inside the thread renders through (see MessageError).
 *
 * Tools return this instead of throwing: it keeps the tool part in
 * `output-available` state, so the stream is not broken and the message
 * persists a record of what went wrong.
 */
export type ToolErrorOutput = { status: 'error'; message: string };

export type MediaToolOutput =
  | { status: 'done'; url: string; mediaType: string; filename: string }
  | ToolErrorOutput;

/** Transcription returns text, not a media file. */
export type TranscribeToolOutput =
  | { status: 'done'; text: string; durationInSeconds?: number }
  | ToolErrorOutput;

export const mediaToolNames = [
  'generate_image',
  'edit_image',
  'generate_video',
  'text_to_speech'
] as const;

export type MediaToolName = (typeof mediaToolNames)[number];

/** Tool map for `UIMessage`'s third generic — narrows `tool-*` part types. */
export type ChatTools = {
  create_artifact: { input: CreateArtifactInput; output: { id: string } };
  generate_image: { input: GenerateImageInput; output: MediaToolOutput };
  edit_image: { input: EditImageInput; output: MediaToolOutput };
  generate_video: { input: GenerateVideoInput; output: MediaToolOutput };
  text_to_speech: { input: TextToSpeechInput; output: MediaToolOutput };
  transcribe_audio: {
    input: TranscribeAudioInput;
    output: TranscribeToolOutput;
  };
};
