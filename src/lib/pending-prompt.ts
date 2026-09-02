/**
 * One-shot hand-off of a prompt's content from the Prompts page into the next
 * new-chat composer. The Prompts page and the new chat live on different routes
 * (`/prompts` → `/`), so the content rides through `sessionStorage` rather than
 * shared React state. The value is consumed (and cleared) on the first read.
 */
const PENDING_PROMPT_KEY = 'pending-prompt'

export function setPendingPrompt(content: string) {
  try {
    sessionStorage.setItem(PENDING_PROMPT_KEY, content)
  } catch {
    // sessionStorage may be unavailable (SSR / privacy mode) — fail silently.
  }
}

/** Returns the pending prompt and clears it, or null if none is queued. */
export function takePendingPrompt(): string | null {
  try {
    const content = sessionStorage.getItem(PENDING_PROMPT_KEY)
    if (content) {
      sessionStorage.removeItem(PENDING_PROMPT_KEY)
    }
    return content
  } catch {
    return null
  }
}
