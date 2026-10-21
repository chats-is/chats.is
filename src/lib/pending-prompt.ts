import { type Attachment } from '@/types';

/**
 * One-shot hand-off of a prompt tried on the Prompts page into the next new
 * chat, which sends it. The Prompts page and the new chat live on different
 * routes (`/prompts` → `/`), so it rides through `sessionStorage` rather than
 * shared React state. The value is consumed (and cleared) on the first read.
 */
const PENDING_PROMPT_KEY = 'pending-prompt';

export type PendingPrompt = {
  content: string;
  /** Files added to it, already uploaded. */
  attachments: Attachment[];
};

export function setPendingPrompt(prompt: PendingPrompt) {
  try {
    sessionStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(prompt));
  } catch {
    // sessionStorage may be unavailable (SSR / privacy mode) — fail silently.
  }
}

/** Returns the pending prompt and clears it, or null if none is queued. */
export function takePendingPrompt(): PendingPrompt | null {
  try {
    const stored = sessionStorage.getItem(PENDING_PROMPT_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    return JSON.parse(stored) as PendingPrompt;
  } catch {
    return null;
  }
}
