import { z } from 'zod';

/**
 * What `/api/speech` accepts. The model and voice are optional: without them
 * the admin's text-to-speech model and that model's own voice apply.
 */
export const speechRequestSchema = z.object({
  modelId: z.string().max(255).optional(),
  // Speech is charged by the character and checked against the quota before
  // a single one is counted, so the length is the only thing that bounds what
  // one request can cost. Generous for a long reply read aloud; not unbounded.
  text: z
    .string()
    .min(1, 'Please enter some text.')
    .max(20_000, 'That is too much text to read aloud at once.'),
  voice: z.string().max(255).optional()
});

export type SpeechRequest = z.infer<typeof speechRequestSchema>;
