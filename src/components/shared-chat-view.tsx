import { useMemo, useState } from 'react';
import { ArtifactFilesContext } from '@/contexts/artifact-files-context';

import { type Artifact, type ChatMessage } from '@/types';
import { artifactFiles } from '@/lib/document';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable';
import { ArtifactsPanel } from '@/components/artifacts-panel';
import { Messages } from '@/components/messages';

interface SharedChatViewProps {
  title: string;
  /** Drawn under the title: when it was, and how long it is. */
  subtitle: string;
  modelId: string;
  messages: ChatMessage[];
  artifacts: Artifact[];
}

/**
 * Laid out the way the chat is: a header bar with the title, the thread
 * scrolling under it, and the artifact panel opening beside both — the header
 * belongs to the thread and moves over with it. Fills the window, like the
 * chat, so the panel stands the full height rather than ending where the
 * messages do.
 */
export function SharedChatView({
  title,
  subtitle,
  modelId,
  messages,
  artifacts
}: SharedChatViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const artifactList = useMemo(
    () =>
      [...artifacts].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
    [artifacts]
  );

  // What an artifact here can read: the files attached in the thread shown.
  const files = useMemo(() => artifactFiles(messages), [messages]);

  const thread = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 flex-col items-center justify-center border-b px-4">
        <span className="max-w-full truncate font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      </header>
      {/* Positioned, so what the messages place absolutely — a button's
          screen-reader label among them — is placed in here and clipped
          with the rest. Left to the body, a label at the foot of a long
          thread makes the window taller, and it scrolls as a whole. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <Messages
          modelId={modelId}
          messages={messages}
          artifacts={artifactList}
          onSelectArtifact={artifactId => {
            setSelectedId(artifactId);
            setPanelOpen(true);
          }}
          isReadonly={true}
        />
      </div>
    </div>
  );

  return (
    <ArtifactFilesContext.Provider value={files}>
      <div className="flex h-svh w-full overflow-hidden">
        {panelOpen && isDesktop ? (
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full w-full overflow-hidden"
          >
            <ResizablePanel
              defaultSize="44%"
              minSize="35%"
              className="flex h-full min-w-0 flex-col overflow-hidden"
            >
              {thread}
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
            {thread}
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
    </ArtifactFilesContext.Provider>
  );
}
