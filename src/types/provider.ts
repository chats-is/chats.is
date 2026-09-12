import { type JSONValue } from 'ai';
import { z } from 'zod';

import { modelCapabilitySchema } from './model';

/** The providers this app knows how to talk to. Declared as a schema so the
 *  admin form and the server validate against the same list. */
export const providerTypeSchema = z.enum([
  'openai',
  'azure',
  'google',
  'vertex',
  'anthropic',
  'bedrock',
  'xai',
  'deepseek'
]);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export type ProviderConfig = {
  type: ProviderType;
  apiKey?: string | null;
  baseUrl?: string | null;
  apiOptions?: Record<string, JSONValue> | null;
};

export type VertexAuthMode = 'service_account' | 'api_key';

export type VertexServiceAccountKey = {
  location?: string;
  credentials?: {
    project_id?: string;
    private_key_id?: string;
    private_key?: string;
  } & Record<string, unknown>;
};

// ============================================================================
// What the provider server functions accept
// ============================================================================

const apiOptionsSchema = z.record(z.string(), z.any());

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: providerTypeSchema,
  apiKey: z.string().min(1),
  image: z.string().optional(),
  baseUrl: z.url().optional().or(z.literal('')),
  isEnabled: z.boolean().default(false),
  apiOptions: apiOptionsSchema.optional(),
  displayOrder: z.number().int().default(0)
});

/** An update may omit `apiKey` to keep the stored one. */
export const providerUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  type: providerTypeSchema,
  apiKey: z.string().optional(),
  image: z.string().optional(),
  baseUrl: z.url().optional().or(z.literal('')),
  isEnabled: z.boolean().optional(),
  apiOptions: apiOptionsSchema.nullable().optional(),
  displayOrder: z.number().int().optional()
});

export const providerIdSchema = z.object({ id: z.string().min(1) });
export const providerRefSchema = z.object({ providerId: z.string().min(1) });
export const providerToggleSchema = z.object({
  id: z.string().min(1),
  isEnabled: z.boolean()
});

/** Which of a provider's models to bring into this install. */
export const providerModelImportSchema = z.object({
  providerId: z.string().min(1),
  items: z
    .array(
      z.object({
        modelId: z.string().min(1).max(255),
        capability: modelCapabilitySchema
      })
    )
    .min(1)
});
