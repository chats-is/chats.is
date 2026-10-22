import { type JSONValue } from 'ai';
import { z } from 'zod';

import { PROVIDER_TYPES } from '@/lib/constant';

import { paginationSchema } from './pagination';
import { PROVIDER_OPTION_SCHEMAS } from './provider-options.gen';

/** The providers this app knows how to talk to. Declared as a schema so the
 *  admin form and the server validate against the same list. */
const providerTypeSchema = z.enum([
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

/**
 * A provider, as anything that calls one needs it: who it is, and what it
 * takes to reach it.
 *
 * One definition, because there is one thing. The config alone is
 * `ProviderConfig`, for the SDK builders that take no interest in which
 * provider they were handed.
 */
export type Provider = ProviderConfig & {
  id: string;
  name: string;
};

/**
 * A provider as one of a model's candidates: the provider, and the id it
 * knows the model by when that is not the model's own (`routedModelId`,
 * from the binding). Absent, the model's id is sent.
 */
export type Candidate = Provider & { routedModelId?: string | null };

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

/**
 * Options the app reads itself rather than hand to the SDK: Azure's video is
 * called through OpenAI's own client, at the API version named here.
 */
const OWN_API_OPTIONS: Partial<
  Record<ProviderType, Record<string, z.ZodType>>
> = {
  azure: { apiVersion: z.string() }
};

/** Each form an option schema's object may take. */
const objectsOf = (schema: z.core.$ZodType): Array<z.ZodObject> =>
  schema instanceof z.ZodUnion
    ? schema.options.flatMap(objectsOf)
    : [schema as z.ZodObject];

/**
 * What is wrong with a provider's API options, if anything.
 *
 * One provider's options go to every call made through it — chat, images,
 * speech, transcription, video — so each key has to be one of the AI SDK's own
 * options for at least one of them, and its value what that option takes.
 * The SDK would drop a key it does not know without a word, and refuse a
 * wrong value only when a user's message is already on its way.
 */
export function apiOptionsError(
  type: ProviderType,
  options: Record<string, unknown>
): string | undefined {
  const objects = PROVIDER_OPTION_SCHEMAS[type].flatMap(objectsOf);
  const own = OWN_API_OPTIONS[type] ?? {};
  for (const [key, value] of Object.entries(options)) {
    const declared = [own[key], ...objects.map(object => object.shape[key])];
    // A key no option names goes to a form that takes keys beyond its own,
    // as Google's video does, handing them on to the API as they are.
    const fields = (
      declared.some(field => field !== undefined)
        ? declared
        : objects.map(({ def: { catchall } }) =>
            catchall instanceof z.ZodNever ? undefined : catchall
          )
    ).filter(field => field !== undefined);
    if (fields.length === 0) {
      const label = PROVIDER_TYPES.find(t => t.value === type)?.label;
      return `Unknown option "${key}" for ${label}`;
    }
    const results = fields.map(field => field.safeParse(value));
    if (results.some(result => result.success)) continue;
    const [issue] = results[0].error!.issues;
    return `${[key, ...issue.path].join('.')}: ${issue.message}`;
  }
  return undefined;
}

/** The form's check, made again on the server against the type saved with. */
const refineApiOptions = (
  input: { type: ProviderType; apiOptions?: Record<string, unknown> | null },
  ctx: z.RefinementCtx
) => {
  const message =
    input.apiOptions && apiOptionsError(input.type, input.apiOptions);
  if (message) ctx.addIssue({ code: 'custom', path: ['apiOptions'], message });
};

export const providerCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    type: providerTypeSchema,
    apiKey: z.string().min(1),
    image: z.string().optional(),
    baseUrl: z.url().optional().or(z.literal('')),
    isEnabled: z.boolean().default(false),
    apiOptions: apiOptionsSchema.optional(),
    displayOrder: z.number().int().default(0)
  })
  .superRefine(refineApiOptions);

/** An update may omit `apiKey` to keep the stored one. */
export const providerUpdateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    type: providerTypeSchema,
    apiKey: z.string().optional(),
    image: z.string().optional(),
    baseUrl: z.url().optional().or(z.literal('')),
    isEnabled: z.boolean().optional(),
    apiOptions: apiOptionsSchema.nullable().optional(),
    displayOrder: z.number().int().optional()
  })
  .superRefine(refineApiOptions);

/** The console's provider table: narrowed, then cut to one page. */
export const providerListSchema = z.object({
  /** Matches a provider's name or its type. */
  q: z.string().optional(),
  ...paginationSchema.shape
});

export const providerIdSchema = z.object({ id: z.string().min(1) });
export const providerRefSchema = z.object({ providerId: z.string().min(1) });
export const providerToggleSchema = z.object({
  id: z.string().min(1),
  isEnabled: z.boolean()
});
