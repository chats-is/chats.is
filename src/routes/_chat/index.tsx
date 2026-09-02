import { createFileRoute } from '@tanstack/react-router';

import { generateUUID } from '@/lib/utils';
import { ChatUI } from '@/components/chat-ui';

export const Route = createFileRoute('/_chat/')({
  component: NewChat
});

function NewChat() {
  const id = generateUUID();

  return <ChatUI key={id} id={id} />;
}
