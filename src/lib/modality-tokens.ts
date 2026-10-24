/** One kind's share of a Gemini call's tokens, as `usageMetadata` lists it. */
type ModalityCount = { modality?: string; tokenCount?: number };

/**
 * The share of a Gemini call's tokens, in or out, that was of one kind —
 * `IMAGE`, `AUDIO`, `TEXT` — or undefined when it does not list them by kind.
 */
export const modalityTokens = (details: unknown, modality: string) =>
  Array.isArray(details)
    ? (details as ModalityCount[])
        .filter(detail => detail.modality === modality)
        .reduce((sum, detail) => sum + (detail.tokenCount ?? 0), 0)
    : undefined;
