import React from 'react'

import { ChatHeader } from '@/components/chat-header'

export function ChatNotFound() {
  return (
    <>
      <ChatHeader />
      <div className="flex size-full max-w-4xl flex-1 items-center justify-center p-4 pb-20">
        <div className="leading-8">
          <h1 className="text-center text-4xl font-medium">Not Found</h1>
          <p className="text-center text-muted-foreground">
            The chat you were looking for could not be found.
          </p>
        </div>
      </div>
    </>
  )
}
