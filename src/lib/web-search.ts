import { type ProviderType } from '@/types';

/**
 * The names the providers give their own web search tool. Shared by the
 * server, which registers them, and the usage count, which looks for them in
 * a finished step.
 */
export const providerWebSearchToolNames: string[] = [
  'web_search',
  'google_search'
];

/**
 * Whether a provider type has a web search of its own. Google's cannot run
 * beside function tools — Gemini drops them — so it counts only where it
 * would be the only tool, which is the delegate path.
 */
export function hasOwnWebSearch(
  type: ProviderType,
  options: { alone: boolean }
): boolean {
  switch (type) {
    case 'openai':
    case 'anthropic':
    case 'xai':
      return true;
    case 'google':
    case 'vertex':
      return options.alone;
    default:
      return false;
  }
}
