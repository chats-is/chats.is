import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * What a chat shows while its messages are still being fetched.
 *
 * Shaped like the thread it is standing in for — a title, a few turns
 * alternating sides, a composer — so the page it settles into is the page that
 * was already there, rather than a word in the middle of an empty screen that
 * everything then jumps away from.
 */
export function ChatPending() {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-16 shrink-0 items-center justify-center border-b px-4">
        <Skeleton className="h-5 w-48" />
      </div>

      <div className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-6">
        {/* Widths vary per turn because real messages do; a column of equal
            bars reads as a loading bar rather than as a conversation. */}
        <ChatPendingTurn className="ml-auto w-2/5" lines={['w-full']} />
        <ChatPendingTurn
          className="mr-12"
          lines={['w-full', 'w-11/12', 'w-3/4']}
        />
        <ChatPendingTurn className="ml-auto w-1/3" lines={['w-full']} />
        <ChatPendingTurn className="mr-12" lines={['w-5/6', 'w-2/3']} />
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 pb-4">
        <div className="w-full rounded-2xl border bg-background p-4 shadow-md">
          <Skeleton className="h-5 w-2/5" />
          <div className="mt-6 flex items-center gap-2">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="ml-auto size-9 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatPendingTurn({
  className,
  lines
}: {
  className?: string;
  lines: Array<string>;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {lines.map((width, index) => (
        <Skeleton key={index} className={cn('h-4', width)} />
      ))}
    </div>
  );
}
