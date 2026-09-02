import {
  DynamicToolUIPart,
  FileUIPart,
  ReasoningUIPart,
  SourceDocumentUIPart,
  SourceUrlUIPart,
  StepStartUIPart,
  TextUIPart
} from 'ai';
import { z } from 'zod';

import { providerMetadataSchema } from './provider-metadata';

export const textUIPartSchema: z.ZodType<TextUIPart> = z.object({
  type: z.literal('text'),
  text: z.string(),
  state: z.enum(['streaming', 'done']).optional(),
  providerMetadata: providerMetadataSchema.optional()
});

export const reasoningUIPartSchema: z.ZodType<ReasoningUIPart> = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  state: z.enum(['streaming', 'done']).optional(),
  providerMetadata: providerMetadataSchema.optional()
});

export const sourceUrlUIPartSchema: z.ZodType<SourceUrlUIPart> = z.object({
  type: z.literal('source-url'),
  sourceId: z.string(),
  url: z.string(),
  title: z.string().optional(),
  providerMetadata: providerMetadataSchema.optional()
});

export const fileUIPartSchema: z.ZodType<FileUIPart> = z.object({
  type: z.literal('file'),
  mediaType: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  providerMetadata: providerMetadataSchema.optional()
});

export const stepStartUIPartSchema: z.ZodType<StepStartUIPart> = z.object({
  type: z.literal('step-start')
});

export const sourceDocumentUIPartSchema: z.ZodType<SourceDocumentUIPart> =
  z.object({
    type: z.literal('source-document'),
    sourceId: z.string(),
    mediaType: z.string(),
    title: z.string(),
    filename: z.string().optional(),
    providerMetadata: providerMetadataSchema.optional()
  });

export const dynamicToolUIPartSchema: z.ZodType<DynamicToolUIPart> = z
  .object({
    type: z.literal('dynamic-tool'),
    toolName: z.string(),
    toolCallId: z.string()
  })
  .and(
    z.union([
      z.object({
        state: z.literal('input-streaming'),
        input: z.unknown().optional(),
        output: z.never().optional(),
        errorText: z.never().optional(),
        providerExecuted: z.boolean().optional()
      }),
      z.object({
        state: z.literal('input-available'),
        input: z.unknown(),
        output: z.never().optional(),
        errorText: z.never().optional(),
        providerExecuted: z.boolean().optional(),
        callProviderMetadata: providerMetadataSchema.optional()
      }),
      z.object({
        state: z.literal('output-available'),
        input: z.unknown(),
        output: z.unknown(),
        errorText: z.never().optional(),
        providerExecuted: z.boolean().optional(),
        callProviderMetadata: providerMetadataSchema.optional(),
        preliminary: z.boolean().optional()
      }),
      z.object({
        state: z.literal('output-error'),
        input: z.unknown().optional(),
        rawInput: z.unknown().optional(),
        output: z.never().optional(),
        errorText: z.string(),
        providerExecuted: z.boolean().optional(),
        callProviderMetadata: providerMetadataSchema.optional()
      })
    ])
  ) as z.ZodType<DynamicToolUIPart>;

// Generic schema for ToolUIPart<TOOLS>
// Matches any type that starts with 'tool-' followed by the tool name
export const toolUIPartSchema: z.ZodType<any> = z
  .object({
    type: z.string().regex(/^tool-/) as z.ZodType<`tool-${string}`>,
    toolCallId: z.string()
  })
  .and(
    z.union([
      z.object({
        state: z.literal('input-streaming'),
        input: z.unknown().optional(),
        providerExecuted: z.boolean().optional(),
        output: z.never().optional(),
        errorText: z.never().optional()
      }),
      z.object({
        state: z.literal('input-available'),
        input: z.unknown(),
        providerExecuted: z.boolean().optional(),
        output: z.never().optional(),
        errorText: z.never().optional(),
        callProviderMetadata: providerMetadataSchema.optional()
      }),
      z.object({
        state: z.literal('output-available'),
        input: z.unknown(),
        output: z.unknown(),
        errorText: z.never().optional(),
        providerExecuted: z.boolean().optional(),
        callProviderMetadata: providerMetadataSchema.optional(),
        preliminary: z.boolean().optional()
      }),
      z.object({
        state: z.literal('output-error'),
        input: z.unknown().optional(),
        rawInput: z.unknown().optional(),
        output: z.never().optional(),
        errorText: z.string(),
        providerExecuted: z.boolean().optional(),
        callProviderMetadata: providerMetadataSchema.optional()
      })
    ])
  );

// Generic schema for DataUIPart<DATA_TYPES>
// Matches any type that starts with 'data-' followed by the data type name
export const dataUIPartSchema: z.ZodType<any> = z.object({
  type: z.string().regex(/^data-/) as z.ZodType<`data-${string}`>,
  id: z.string().optional(),
  data: z.unknown()
});
