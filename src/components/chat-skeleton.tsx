import { Skeleton } from '@/components/ui/skeleton';
import { ChatHeader } from '@/components/chat-header';

/**
 * The shape of a conversation, while the conversation itself is on its way.
 *
 * Shown for a chat the browser has not read yet — opening one from the sidebar
 * for the first time. It stands in the new chat's place rather than leaving the
 * one just left on screen, which is the alternative and reads as the wrong
 * conversation under the right address.
 */
export function ChatSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <ChatHeader />
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        {[
          { role: 'user', lines: ['w-48'] },
          { role: 'assistant', lines: ['w-full', 'w-11/12', 'w-2/3'] },
          { role: 'user', lines: ['w-36'] },
          { role: 'assistant', lines: ['w-full', 'w-3/4'] }
        ].map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === 'user'
                ? 'mb-6 flex flex-row-reverse items-start'
                : 'mb-6 flex items-start'
            }
          >
            <Skeleton className="size-9 shrink-0 rounded-full" />
            {/* `min-h-9 justify-center`, as in <Message>: a single line sits
                level with the middle of the avatar rather than at its top. */}
            <div
              className={
                turn.role === 'user'
                  ? 'mr-3 flex min-h-9 w-full flex-col items-end justify-center gap-2'
                  : // `pr-12` as in <Message>: a reply stops short of the
                    // right edge, it does not run the full width.
                    'ml-3 flex min-h-9 w-full flex-col justify-center gap-2 pr-12'
              }
            >
              {turn.lines.map((width, line) => (
                <Skeleton key={line} className={`h-4 ${width}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* The composer holds its place. It is the one part of the page that is
          the same in every chat, so letting it vanish and come back makes the
          whole layout jump for something that never actually changed. */}
      <div className="mx-auto w-full max-w-4xl px-4 pb-4">
        <Skeleton className="h-[76px] w-full rounded-2xl" />
      </div>
    </div>
  );
}
