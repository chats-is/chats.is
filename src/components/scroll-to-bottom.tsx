import type { ReactNode } from 'react';
import type { UseChatHelpers } from '@ai-sdk/react';
import ReactScrollToBottom from 'react-scroll-to-bottom';

import type { ChatMessage } from '@/types';
import { ButtonScrollToBottom } from '@/components/button-scroll-to-bottom';

interface ScrollToBottomProps
  extends
    Partial<Pick<UseChatHelpers<ChatMessage>, 'status'>>,
    Pick<UseChatHelpers<ChatMessage>, 'messages'> {
  children: ReactNode;
}

export default function ScrollToBottom({
  children,
  status,
  messages
}: ScrollToBottomProps) {
  return (
    <ReactScrollToBottom
      className="size-full"
      scrollViewClassName="size-full flex flex-col items-center"
      followButtonClassName="hidden"
      initialScrollBehavior="auto"
      mode="bottom"
    >
      {children}
      <ButtonScrollToBottom status={status} messages={messages} />
    </ReactScrollToBottom>
  );
}
