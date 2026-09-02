import { useEffect } from 'react'
import type { UseChatHelpers } from '@ai-sdk/react'
import { ArrowDown } from 'lucide-react'
import { useScrollToBottom, useSticky } from 'react-scroll-to-bottom'

import type { ChatMessage } from '@/types'
import { Button } from '@/components/ui/button'

interface ButtonScrollToBottomProps
  extends
    Partial<Pick<UseChatHelpers<ChatMessage>, 'status'>>,
    Pick<UseChatHelpers<ChatMessage>, 'messages'> {}

export function ButtonScrollToBottom({
  status,
  messages,
}: ButtonScrollToBottomProps) {
  const [sticky] = useSticky()
  const scrollToBottom = useScrollToBottom()

  useEffect(() => {
    if (status === 'submitted' || status === 'streaming') {
      scrollToBottom({ behavior: 'smooth' })
    }
  }, [status, messages, scrollToBottom])

  return (
    <Button
      variant="outline"
      size="icon"
      className="absolute bottom-3 left-1/2 z-10 size-8 -translate-x-1/2 rounded-full bg-background transition-opacity duration-300 disabled:cursor-default disabled:opacity-0 sm:right-8"
      disabled={sticky}
      onClick={() => scrollToBottom({ behavior: 'smooth' })}
    >
      <ArrowDown className="text-muted-foreground" />
      <span className="sr-only">Scroll to bottom</span>
    </Button>
  )
}
