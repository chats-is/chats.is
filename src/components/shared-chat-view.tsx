import { useMemo, useState } from 'react'

import { type Artifact, type ChatMessage } from '@/types'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ArtifactsPanel } from '@/components/artifacts-panel'
import { Messages } from '@/components/messages'

interface SharedChatViewProps {
  modelId: string
  messages: ChatMessage[]
  artifacts: Artifact[]
  className?: string
}

export function SharedChatView({
  modelId,
  messages,
  artifacts,
  className,
}: SharedChatViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const artifactList = useMemo(
    () =>
      [...artifacts].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    [artifacts],
  )

  return (
    <div className="flex min-h-0 w-full">
      {panelOpen && isDesktop ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full w-full overflow-hidden"
        >
          <ResizablePanel
            defaultSize="44%"
            minSize="35%"
            className="h-full min-w-0 overflow-hidden"
          >
            <div className="h-full min-w-0 overflow-hidden">
              <Messages
                className={className}
                modelId={modelId}
                messages={messages}
                artifacts={artifactList}
                onSelectArtifact={(artifactId) => {
                  setSelectedId(artifactId)
                  setPanelOpen(true)
                }}
                isReadonly={true}
              />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="56%"
            minSize="25%"
            maxSize="65%"
            className="h-full min-w-0 overflow-hidden"
          >
            <ArtifactsPanel
              open={panelOpen}
              onOpenChange={setPanelOpen}
              artifacts={artifactList}
              selectedId={selectedId}
              onSelect={setSelectedId}
              desktopContainerClassName="h-full w-full min-w-0 max-w-none border-l-0"
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <Messages
              className={className}
              modelId={modelId}
              messages={messages}
              artifacts={artifactList}
              onSelectArtifact={(artifactId) => {
                setSelectedId(artifactId)
                setPanelOpen(true)
              }}
              isReadonly={true}
            />
          </div>
          <ArtifactsPanel
            open={panelOpen}
            onOpenChange={setPanelOpen}
            artifacts={artifactList}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </>
      )}
    </div>
  )
}
