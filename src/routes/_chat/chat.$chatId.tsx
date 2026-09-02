import { createFileRoute } from '@tanstack/react-router';

import { convertToChatMessages } from '@/lib/utils';
import { chatQueries } from '@/server/fn/chat';
import { ChatNotFound } from '@/components/chat-notfound';
import { ChatUI } from '@/components/chat-ui';

export const Route = createFileRoute('/_chat/chat/$chatId')({
  // No type filter: legacy media chats (image/video/audio) open here too.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      chatQueries.detail({ id: params.chatId, includeArtifacts: true })
    ),
  head: ({ loaderData }) => ({
    meta: loaderData?.title ? [{ title: loaderData.title }] : []
  }),
  component: ChatPage
});

function ChatPage() {
  const chat = Route.useLoaderData();

  if (!chat) {
    return <ChatNotFound />;
  }

  const chatMessages = convertToChatMessages(chat.messages);

  return (
    <ChatUI
      key={chat.id}
      id={chat.id}
      initialChat={{
        title: chat.title,
        modelId: chat.modelId ?? undefined
      }}
      initialMessages={chatMessages}
      initialArtifacts={chat.artifacts ?? []}
    />
  );
}
