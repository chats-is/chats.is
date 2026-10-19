import { CircleAlert, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A failure rendered inside the message thread.
 *
 * Every in-thread failure goes through this one component so they are
 * indistinguishable to the user, whatever produced them: a media tool's
 * `ToolErrorOutput`, the AI SDK's own `errorText` when a tool throws, or a
 * request the server refused before any of that (see `chatRequestErrorMessage`).
 *
 * Deliberately verbatim — the message it is handed is the message it shows. An
 * earlier version had the model relay tool failures in its own words, and it
 * reliably dropped the model name, the cause and the fix.
 */
export function MessageError({
  message,
  onRetry,
  className
}: {
  message?: string;
  /** Asks again, from a failure that left no reply to retry from. */
  onRetry?: () => void;
  className?: string;
}) {
  return (
    // The failure in red, and the way out a plain button beside it.
    <div
      className={cn(
        'my-2 flex w-fit items-center gap-2 text-sm text-destructive first:mt-0 last:mb-0',
        className
      )}
    >
      <CircleAlert className="size-4 shrink-0" />
      <span>{message || 'Something went wrong.'}</span>
      {onRetry && (
        <Button
          variant="outline"
          size="xs"
          className="rounded-full text-foreground"
          onClick={onRetry}
        >
          <RefreshCw />
          Retry
        </Button>
      )}
    </div>
  );
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
        className
      )}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      <span>No response</span>
    </div>
  );
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
  const raw = error?.message?.trim();
  if (!raw) return 'Something went wrong.';

  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed?.error === 'string' && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Not JSON — fall through.
  }

  return raw;
}
