import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { peekChatSession } from '@/lib/chat-session';
import { formatTitle, pageTitle, useAppName } from '@/lib/head';
import { convertToChatMessages } from '@/lib/utils';
import { chatQueries } from '@/server/functions/chat';
import { ChatNotFound } from '@/components/chat-notfound';
import { ChatSkeleton } from '@/components/chat-skeleton';
import { ChatUI } from '@/components/chat-ui';

export const Route = createFileRoute('/_chat/chat/$chatId')({
  // The server reads the chat and sends it with the page, but does not draw
  // it. The conversation sits inside a scroller that only exists in a browser,
  // so a server render of this page was the frame around an empty thread —
  // work done to show nothing, replaced on hydration anyway. What it draws
  // instead is the placeholder below, which is what the page shows while it
  // loads in the browser too.
  ssr: 'data-only',
  // Only ever seen from the server: in the browser the loader below does not
  // wait, so the route is never pending, and the page says it is loading from
  // the inside — where it can tell a chat it has never read from one it is
  // merely revalidating.
  pendingComponent: ChatSkeleton,
  pendingMinMs: 0,
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
  const {
    data: chat,
    isPending,
    isFetching,
    isStale
  } = useQuery(chatQueries.detail({ id: chatId, includeArtifacts: true }));
  const app = useAppName();

  // Which chat this page has finished reading for the current visit. A chat's
  // cached copy can be far behind the chat: a new conversation moves to this
  // address while its first reply is still being written, and what is read —
  // and cached — at that moment is the user's message and nothing else. Coming
  // back minutes later, that was what the conversation was seeded from, and a
  // seed is taken once: the fresh copy arrived behind the page and went
  // nowhere, so the reply was simply missing until the browser was reloaded.
  //
  // So a copy that is out of date is not drawn from. The page waits for the
  // read already under way, as every other page here does, and draws once.
  // Only at the start of a visit — a refresh that happens later, while the
  // conversation is on screen, must not take the conversation down to do it.
  const [readFor, setReadFor] = useState<string | null>(null);
  useEffect(() => {
    if (!isPending && !isFetching) setReadFor(chatId);
  }, [chatId, isPending, isFetching]);

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

  const behind = readFor !== chatId && (isFetching || isStale);
  if ((isPending || behind) && !live) {
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
        modelId: chat?.modelId ?? undefined,
        isGenerating: Boolean(chat?.streamId)
      }}
      initialMessages={chat ? convertToChatMessages(chat.messages) : []}
      initialArtifacts={chat?.artifacts ?? []}
    />
  );
}
