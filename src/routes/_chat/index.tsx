import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { generateUUID } from '@/lib/utils';
import { ChatUI } from '@/components/chat-ui';

export const Route = createFileRoute('/_chat/')({
  component: NewChat
});

function NewChat() {
  // The id has to survive re-renders: it is the chat being composed, and it is
  // also this component's key. Generating it inline would hand the composer a
  // new identity on every render and throw away whatever was typed. It was a
  // server component before, where a render happened once per request.
  const [id] = useState(generateUUID);

  return <ChatUI key={id} id={id} />;
}
