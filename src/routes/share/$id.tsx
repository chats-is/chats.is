import { createFileRoute, notFound } from '@tanstack/react-router';
import { format } from 'date-fns';

import { PreferencesProvider } from '@/contexts/preferences-context';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';
import { convertToChatMessages } from '@/lib/utils';
import { getSharedChat } from '@/server/fn/share';
import { getSystemSettingsFn } from '@/server/fn/settings';
import { SharedChatView } from '@/components/shared-chat-view';

/** A share link is public: no guard above it, and none needed. */
export const Route = createFileRoute('/share/$id')({
  loader: async ({ params }) => {
    const chat = await getSharedChat({ data: { id: params.id } });
    if (!chat) {
      throw notFound();
    }

    return { chat, settings: await getSystemSettingsFn() };
  },
  head: ({ loaderData }) => ({
    meta: loaderData?.chat.title ? [{ title: loaderData.chat.title }] : []
  }),
  component: SharedChatPage
});

function SharedChatPage() {
  const { chat, settings } = Route.useLoaderData();
  const chatMessages = convertToChatMessages(chat.messages);

  return (
    <SystemSettingsProvider settings={settings}>
      <PreferencesProvider>
        <div className="space-y-6">
          <div className="mx-auto max-w-4xl px-4">
            <div className="space-y-1 border-b py-6">
              <h1 className="text-2xl font-bold">{chat.title}</h1>
              <div className="text-sm text-muted-foreground">
                {format(chat.createdAt, 'MMMM d, yyyy')} ·{' '}
                {chat.messages.length}
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
      </PreferencesProvider>
    </SystemSettingsProvider>
  );
}
