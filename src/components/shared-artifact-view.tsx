import { useState } from 'react';
import { ArtifactFilesContext } from '@/contexts/artifact-files-context';

import { type Artifact, type ArtifactFile } from '@/types';
import { ArtifactViewer } from '@/components/artifact-viewer';

/**
 * An artifact shared on its own, filling the window: its title, the switch
 * between preview and source, copy and download, and the artifact — laid out
 * as the chat's panel lays it out. Its chat stays behind: the page is given
 * neither the chat nor the message, so neither can be shown — only the files
 * attached on the way to it, which it may read.
 */
export function SharedArtifactView({
  artifact,
  files
}: {
  artifact: Omit<Artifact, 'chatId' | 'messageId'>;
  files: ArtifactFile[];
}) {
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview');
  // The viewer is the chat's, and names the chat and message an artifact
  // belongs to; a shared one has neither here.
  const shown: Artifact = { ...artifact, chatId: '', messageId: '' };

  return (
    <ArtifactFilesContext.Provider value={files}>
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
        <div className="flex h-12 shrink-0 items-center border-b px-4">
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
    </ArtifactFilesContext.Provider>
  );
}

/**
 * An artifact shared on its own, embedded in someone else's page: the
 * artifact alone, filling the frame it is given — its preview where it has
 * one, else its source — with nothing around it to press.
 */
export function EmbeddedArtifactView({
  artifact,
  files
}: {
  artifact: Omit<Artifact, 'chatId' | 'messageId'>;
  files: ArtifactFile[];
}) {
  const shown: Artifact = { ...artifact, chatId: '', messageId: '' };

  return (
    <ArtifactFilesContext.Provider value={files}>
      <div className="h-svh w-full overflow-auto bg-background">
        <ArtifactViewer artifact={shown} hideHeader={true} viewMode="preview" />
      </div>
    </ArtifactFilesContext.Provider>
  );
}
