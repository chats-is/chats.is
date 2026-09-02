import { z } from 'zod';

import { jsonValueSchema } from './json-value';

/**
Additional provider-specific metadata that is returned from the provider.

This is needed to enable provider-specific functionality that can be
fully encapsulated in the provider.
 */
export type ProviderMetadata = Record<string, Record<string, any>>;

export const providerMetadataSchema: z.ZodType<ProviderMetadata> = z.record(
  z.string(),
  z.record(z.string(), jsonValueSchema)
);
