import { useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { peekChatSession } from '@/lib/chat-session';
import { formatTitle, pageTitle, useAppName } from '@/lib/head';
import { convertToChatMessages } from '@/lib/utils';
import { chatQueries } from '@/server/fn/chat';
import { ChatNotFound } from '@/components/chat-notfound';
import { ChatSkeleton } from '@/components/chat-skeleton';
import { ChatUI } from '@/components/chat-ui';

// No pending component here on purpose. A placeholder at the route level would
// unmount the whole match whenever the loader re-runs; the page says it is
// loading from the inside instead, where it can tell a chat it has never read
// from one it is merely revalidating.
export const Route = createFileRoute('/_chat/chat/$chatId')({
  // No type filter: legacy media chats (image/video/audio) open here too.
  //
  // Awaited on the server, where the page is rendered once and should arrive
  // complete. Not awaited in the browser: a loader that blocks leaves the
  // reader looking at the chat they just left, under the address of the one
  // they clicked — the sidebar has already moved, so the page is the only
  // thing still claiming otherwise. Started here, read by the component.
  loader: async ({ context, params }) => {
    const chat = chatQueries.detail({
      id: params.chatId,
      includeArtifacts: true
    });

    if (typeof window === 'undefined') {
      return context.queryClient.ensureQueryData(chat);
    }

    void context.queryClient.prefetchQuery(chat);
    return context.queryClient.getQueryData(chat.queryKey);
  },
  head: ({ matches, loaderData }) => ({
    meta: [{ title: pageTitle(matches, loaderData?.title ?? undefined) }]
  }),
  component: ChatPage
});

function ChatPage() {
  const { chatId } = Route.useParams();
  const { data: chat, isPending } = useQuery(
    chatQueries.detail({ id: chatId, includeArtifacts: true })
  );
  const app = useAppName();

  // A head is settled when the match is made, and a chat opened from the
  // sidebar has not been read by then. Name the tab once it arrives.
  useEffect(() => {
    if (chat?.title) document.title = formatTitle(chat.title, app);
  }, [chat?.title, app]);

  // A conversation already running under this id — the reply that is being
  // streamed right now, on the page this one is replacing. It carries its own
  // messages, so it is drawn immediately: a placeholder here would blank the
  // very reply the reader is watching arrive.
  const live = peekChatSession(chatId);

  if (isPending && !live) {
    return <ChatSkeleton />;
  }

  if (!isPending && !chat) {
    return <ChatNotFound />;
  }

  return (
    <ChatUI
      key={chatId}
      id={chatId}
      initialChat={{
        title: chat?.title ?? live?.title ?? '',
        modelId: chat?.modelId ?? undefined
      }}
      initialMessages={chat ? convertToChatMessages(chat.messages) : []}
      initialArtifacts={chat?.artifacts ?? []}
    />
  );
}
