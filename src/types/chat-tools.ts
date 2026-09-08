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
      'Aspect ratio like "16:9" — suggest one of the available values when the user\'s wording implies a format (e.g. portrait/竖版 → 9:16, square → 1:1); omit otherwise. A ratio the user set in the app wins over this.'
    ),
  size: z
    .string()
    .optional()
    .describe(
      'Image size like "1024x1024" — suggest one of the available values when the user\'s wording implies one; omit otherwise. A size the user set in the app wins over this.'
    ),
  resolution: z
    .string()
    .optional()
    .describe(
      'Image resolution like "2K" — suggest one of the available values when the user\'s wording implies one (e.g. 高清); omit otherwise. A resolution the user set in the app wins over this.'
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

export const editVideoInputSchema = z.object({
  videoUrl: z
    .string()
    .describe(
      'URL of the video from this conversation to edit — a user upload or one generated earlier'
    ),
  prompt: z
    .string()
    .min(1)
    .describe('What to change in the video, in natural language')
});

export const generateVideoInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('A detailed description of the video to generate'),
  imageUrl: z
    .string()
    .optional()
    .describe(
      'URL of an image from this conversation to animate — a user upload or an image generated earlier. Must be an image: to change an existing video, use edit_video instead. Omit to generate from the text alone.'
    ),
  size: z
    .string()
    .optional()
    .describe(
      'Output size in pixels, for a model that names its output that way rather than by ratio. Pick from the available values when the wording implies one; omit otherwise'
    ),
  aspectRatio: z
    .string()
    .optional()
    .describe(
      'Aspect ratio like "16:9" — suggest one of the available values when the user\'s wording implies a format (e.g. portrait/竖版 → 9:16); omit otherwise. A ratio the user set in the app wins over this.'
    ),
  resolution: z
    .string()
    .optional()
    .describe(
      'Resolution like "1080p" — suggest one of the available values when the user\'s wording implies one (e.g. 高清); omit otherwise. A resolution the user set in the app wins over this.'
    ),
  duration: z
    .number()
    .optional()
    .describe(
      "Duration in seconds — suggest the closest available value when the user's wording implies a length; omit otherwise. A duration the user set in the app wins over this, and it decides the cost."
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
      "Voice name — suggest one of the available values when the user's wording implies a voice style; omit otherwise. A voice the user set in the app wins over this."
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
export type EditVideoInput = z.infer<typeof editVideoInputSchema>;
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
  'edit_video',
  'text_to_speech'
] as const;

export type MediaToolName = (typeof mediaToolNames)[number];

/** Tool map for `UIMessage`'s third generic — narrows `tool-*` part types. */
export type ChatTools = {
  create_artifact: { input: CreateArtifactInput; output: { id: string } };
  generate_image: { input: GenerateImageInput; output: MediaToolOutput };
  edit_image: { input: EditImageInput; output: MediaToolOutput };
  generate_video: { input: GenerateVideoInput; output: MediaToolOutput };
  edit_video: { input: EditVideoInput; output: MediaToolOutput };
  text_to_speech: { input: TextToSpeechInput; output: MediaToolOutput };
  transcribe_audio: {
    input: TranscribeAudioInput;
    output: TranscribeToolOutput;
  };
};
