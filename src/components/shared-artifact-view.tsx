import { useState } from 'react';

import { type Artifact } from '@/types';
import { ArtifactViewer } from '@/components/artifact-viewer';

/**
 * An artifact shared on its own, filling the window: its title, the switch
 * between preview and source, copy and download, and the artifact — laid out
 * as the chat's panel lays it out. Its chat stays behind: the page is given
 * neither the chat nor the message, so neither can be shown.
 */
export function SharedArtifactView({
  artifact
}: {
  artifact: Omit<Artifact, 'chatId' | 'messageId'>;
}) {
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview');
  // The viewer is the chat's, and names the chat and message an artifact
  // belongs to; a shared one has neither here.
  const shown: Artifact = { ...artifact, chatId: '', messageId: '' };

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
      <div className="flex h-16 shrink-0 items-center border-b px-4">
        <ArtifactViewer
          artifact={shown}
          hideContent={true}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ArtifactViewer
          artifact={shown}
          hideHeader={true}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>
    </div>
  );
}
