import { CircleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A failure rendered inside the message thread.
 *
 * Every in-thread failure goes through this one component so they are
 * indistinguishable to the reader, whatever produced them: a media tool's
 * `ToolErrorOutput`, the AI SDK's own `errorText` when a tool throws, or a
 * request the server refused before any of that (see `chatRequestErrorMessage`).
 *
 * Deliberately verbatim — the message it is handed is the message it shows. An
 * earlier version had the model relay tool failures in its own words, and it
 * reliably dropped the model name, the cause and the fix.
 */
export function MessageError({
  message,
  className,
}: {
  message?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'my-2 flex w-fit items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive',
        className,
      )}
    >
      <CircleAlert className="size-4 shrink-0" />
      <span>{message || 'Something went wrong.'}</span>
    </div>
  )
}

/**
 * A turn that produced no answer, as it reads later.
 *
 * The live failure is shown in full while it is happening, because that is
 * when the reason is worth acting on. Re-opening the conversation is a
 * different moment: the quota has reset, the model has been configured, the
 * provider is back — so the reason is stale, while "nothing came back here"
 * stays true. Quiet, and without the wording of a condition that has passed.
 */
export function MessageIncomplete({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'my-2 flex w-fit items-center gap-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      <span>No response</span>
    </div>
  )
}

/**
 * Pull the readable part out of a failed chat request.
 *
 * The AI SDK's transport rejects with the raw response body as the message, so
 * a refusal from our route arrives as the literal string
 * `{"error":"<reason>"}`. Unwrap it; fall back to the text as-is for anything
 * that is not our JSON shape (a proxy's HTML error page, say).
 */
export function chatRequestErrorMessage(error: Error | undefined): string {
  const raw = error?.message?.trim()
  if (!raw) return 'Something went wrong.'

  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (typeof parsed?.error === 'string' && parsed.error) {
      return parsed.error
    }
  } catch {
    // Not JSON — fall through.
  }

  return raw
}
