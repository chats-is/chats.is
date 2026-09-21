import { createFileRoute, notFound } from '@tanstack/react-router';
import { format } from 'date-fns';

import { pageTitle } from '@/lib/head';
import { convertToChatMessages } from '@/lib/utils';
import { getSharedChat } from '@/server/functions/share';
import { RoutePending } from '@/components/route-pending';
import { SharedChatView } from '@/components/shared-chat-view';

/** A share link is public: no guard above it, and none needed. */
export const Route = createFileRoute('/share/$id')({
  // The chat and nothing else. This page used to load the install's settings
  // too — every model and its providers — for a read-aloud button it no longer
  // draws; it is opened by people with no account, as often as a link is
  // passed around, and none of that was theirs to need.
  loader: async ({ params }) => {
    const chat = await getSharedChat({ data: { id: params.id } });

    if (!chat) {
      throw notFound();
    }

    return { chat };
  },
  head: ({ matches, loaderData }) => ({
    meta: [{ title: pageTitle(matches, loaderData?.chat.title ?? undefined) }]
  }),
  pendingComponent: RoutePending,
  component: SharedChatPage
});

function SharedChatPage() {
  const { chat } = Route.useLoaderData();
  const chatMessages = convertToChatMessages(chat.messages);

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-4xl px-4">
        <div className="space-y-1 border-b py-6">
          <h1 className="text-2xl font-bold">{chat.title}</h1>
          <div className="text-sm text-muted-foreground">
            {format(chat.createdAt, 'MMMM d, yyyy')} · {chat.messages.length}
            <span className="pl-0.5">messages</span>
          </div>
        </div>
      </div>
      <SharedChatView
        className="pb-5"
        modelId={chat.modelId}
        messages={chatMessages}
        artifacts={chat.artifacts ?? []}
      />
    </div>
  );
}
