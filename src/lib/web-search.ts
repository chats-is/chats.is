import { type ProviderType } from '@/types';

/**
 * Whether a provider type has a web search of its own, which runs beside the
 * chat's other tools. Google's does from Gemini 3 on; an older Gemini drops
 * the function tools beside it, so its search switch is left off.
 */
export function hasOwnWebSearch(type: ProviderType): boolean {
  switch (type) {
    case 'openai':
    case 'anthropic':
    case 'xai':
    case 'google':
    case 'vertex':
      return true;
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
    args.model.providerTypes.some(hasOwnWebSearch)
  );
}

/**
 * Whether a chat on this model can search X — the web's rule, asked of X:
 * the X search model is there to be asked, or the model searches X itself.
 * xAI's is the only search of X, and the model's search switch governs it
 * as it does the web's.
 */
export function canSearchX(args: {
  mode: WebSearchMode;
  /** The X search model, when one is set and can answer. */
  xSearchModelId: string | null;
  model: {
    modelId: string;
    supportsWebSearch?: boolean | null;
    providerTypes: ProviderType[];
  };
}): boolean {
  if (args.xSearchModelId) return true;
  return searchesXForItself(args);
}

/** Whether the model searches X with xAI's own search. */
export function searchesXForItself(args: {
  mode: WebSearchMode;
  xSearchModelId: string | null;
  model: {
    modelId: string;
    supportsWebSearch?: boolean | null;
    providerTypes: ProviderType[];
  };
}): boolean {
  const selfServes = args.xSearchModelId === args.model.modelId;
  return (
    (args.mode === 'auto' || selfServes) &&
    !!args.model.supportsWebSearch &&
    args.model.providerTypes.includes('xai')
  );
}
