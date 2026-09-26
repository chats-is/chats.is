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

/** Who searches: `auto` lets a model with a search of its own use it;
 *  `model` always asks the search model. */
export type WebSearchMode = 'auto' | 'model';

/**
 * Whether a chat on this model can search at all — the one rule, read by
 * the server to decide what tools to give and by the page to decide whether
 * to offer the switch. Either the search model is there to be asked, or the
 * model can search for itself: its switch is on, the mode allows it (or the
 * search model is the model itself, which then searches on its own), and one
 * of its providers has a search that runs beside function tools.
 */
export function canSearchWeb(args: {
  mode: WebSearchMode;
  /** The search model, when one is set and can answer. */
  searchModelId: string | null;
  model: {
    modelId: string;
    supportsWebSearch?: boolean | null;
    providerTypes: ProviderType[];
  };
}): boolean {
  if (args.searchModelId) return true;
  return searchesForItself(args);
}

/** Whether the model searches with its own provider's search. */
export function searchesForItself(args: {
  mode: WebSearchMode;
  searchModelId: string | null;
  model: {
    modelId: string;
    supportsWebSearch?: boolean | null;
    providerTypes: ProviderType[];
  };
}): boolean {
  const selfServes = args.searchModelId === args.model.modelId;
  return (
    (args.mode === 'auto' || selfServes) &&
    !!args.model.supportsWebSearch &&
    args.model.providerTypes.some(type =>
      hasOwnWebSearch(type, { alone: false })
    )
  );
}
