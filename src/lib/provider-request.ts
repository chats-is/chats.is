import { type JSONValue } from 'ai';

import { type ProviderRequest, type ProviderType } from '@/types';

/**
 * The headers a provider names a request by in its own logs: OpenAI's, Azure's
 * and xAI's `x-request-id`, Anthropic's `request-id`, Bedrock's
 * `x-amzn-requestid`, DeepSeek's `x-ds-trace-id`. Google sends none.
 */
const REQUEST_ID_HEADERS = [
  'x-request-id',
  'request-id',
  'x-amzn-requestid',
  'x-ds-trace-id'
];

/**
 * The ids one call's response carries, as the SDK hands it back; null when it
 * carries neither.
 *
 * A text call's response has an id even when the provider sent none: the SDK
 * makes one up, `aitxt-…`, which no provider's log has ever seen.
 */
export function providerRequestOf(response?: {
  id?: string;
  headers?: Record<string, string | undefined>;
  providerMetadata?: Record<string, Record<string, unknown> | undefined>;
}): ProviderRequest | null {
  const responseId =
    response?.id && !response.id.startsWith('aitxt-') ? response.id : undefined;
  const headers = response?.headers ?? {};
  const requestId =
    REQUEST_ID_HEADERS.map(name => headers[name]).find(Boolean) ??
    metadataRequestId(response?.providerMetadata);
  if (!responseId && !requestId) return null;
  return {
    ...(responseId && { responseId }),
    ...(requestId && { requestId })
  };
}

/**
 * The request id a call's provider metadata carries where its headers carry
 * none. xAI's video is polled for, and the poll the SDK hands back answers
 * with no id; the job's, the same as its request's, comes in the metadata.
 */
const metadataRequestId = (
  metadata?: Record<string, Record<string, unknown> | undefined>
) =>
  Object.values(metadata ?? {})
    .map(entry => entry?.requestId)
    .find((id): id is string => typeof id === 'string' && id !== '');

/** The ids of each call a result was made of, leaving out those with none. */
export function providerRequestsOf(
  responses: ReadonlyArray<Parameters<typeof providerRequestOf>[0]>
): ProviderRequest[] {
  return responses
    .map(providerRequestOf)
    .filter((request): request is ProviderRequest => request !== null);
}

/**
 * What a call tells its provider about itself, so the provider's records of
 * it can be matched to ours: the usage row it is recorded under, where the
 * provider has a field for one, spelt the provider's way. Who the user is
 * stays ours. Anthropic, xAI, DeepSeek and Gemini's API have no such field,
 * and are matched by the ids they answer with instead; Vertex keeps its
 * labels in the billing reports rather than the request log.
 */
export function requestTags(
  type: ProviderType,
  usageId: string
): Record<string, JSONValue> {
  switch (type) {
    case 'openai':
    case 'azure':
      return { metadata: { usage_id: usageId } };
    case 'vertex':
      return { labels: { usage_id: usageId } };
    case 'bedrock':
      return { requestMetadata: { usage_id: usageId } };
    case 'anthropic':
    case 'xai':
    case 'deepseek':
    case 'google':
      return {};
  }
}

/**
 * A call's provider options: the admin's, with our tags laid in. A field
 * both name is the admin's, except the record a tag goes in — `metadata`,
 * `labels`, `requestMetadata` — which keeps the admin's keys beside ours, and
 * ours over theirs, so the call can always be matched to its usage row.
 */
export function withRequestTags(
  type: ProviderType,
  usageId: string,
  apiOptions?: Record<string, JSONValue> | null
): Record<string, JSONValue> {
  const tags = requestTags(type, usageId);
  const options: Record<string, JSONValue> = { ...tags, ...apiOptions };
  for (const [key, ours] of Object.entries(tags)) {
    const theirs = apiOptions?.[key];
    if (isObject(theirs) && isObject(ours)) {
      options[key] = { ...theirs, ...ours };
    }
  }
  return options;
}

const isObject = (
  value: JSONValue | undefined
): value is Record<string, JSONValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
