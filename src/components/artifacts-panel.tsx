import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { type Artifact } from '@/types';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ArtifactViewer } from '@/components/artifact-viewer';

interface ArtifactsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: Artifact[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  desktopContainerClassName?: string;
  /** Asks the chat to fix a preview's error; absent on a share page. */
  onFix?: (artifact: Artifact, error: string) => void;
  /** Asks the chat about a passage selected in an artifact; absent on a
   *  share page. */
  onEdit?: (artifact: Artifact, selection: string, request: string) => void;
  /** Offers to share an artifact on its own; not on a share page. */
  canShare?: boolean;
  /** Offers to duplicate one into a new chat; not on a share page. */
  canDuplicate?: boolean;
}

export function ArtifactsPanel({
  open,
  onOpenChange,
  artifacts,
  selectedId,
  onSelect,
  desktopContainerClassName,
  onFix,
  onEdit,
  canShare,
  canDuplicate
}: ArtifactsPanelProps) {
  // The source/preview choice is a persistent preference: switching artifacts
  // keeps the current view (a JSON/code artifact viewed as source stays source
  // after switching) instead of snapping back to a per-artifact default.
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('preview');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Newest first, so the artifact switcher and default selection favour the most
  // recent artifact.
  const sortedArtifacts = useMemo(
    () =>
      [...artifacts].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
    [artifacts]
  );
  const selected =
    sortedArtifacts.find(artifact => artifact.id === selectedId) ??
    sortedArtifacts[0];
  const isStreaming = selected?.status === 'streaming';

  // Streaming always shows source (watch the code stream); otherwise the user's
  // persistent choice. Non-previewable artifacts fall back to source in the
  // viewer itself.
  const effectiveViewMode: 'source' | 'preview' = isStreaming
    ? 'source'
    : viewMode;

  if (!open) {
    return null;
  }

  const content =
    artifacts.length === 0 ? (
      <div className="flex h-full flex-col">
        <div className="sticky top-0 z-10 flex h-16 items-center justify-end border-b bg-background px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No artifacts yet.
        </div>
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="sticky top-0 z-10 flex h-16 items-center border-b bg-background px-4">
          <ArtifactViewer
            artifact={selected}
            artifacts={sortedArtifacts}
            onSelectArtifact={onSelect}
            onClose={() => onOpenChange(false)}
            hideContent={true}
            viewMode={effectiveViewMode}
            onViewModeChange={setViewMode}
            canShare={canShare}
            duplicateFrom={
              canDuplicate ? { artifactId: selected.id } : undefined
            }
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <ArtifactViewer
            artifact={selected}
            artifacts={sortedArtifacts}
            hideHeader={true}
            viewMode={effectiveViewMode}
            onViewModeChange={setViewMode}
            onFix={onFix}
            onEdit={onEdit}
          />
        </div>
      </div>
    );

  return (
    <>
      {isDesktop && (
        <div
          className={cn(
            'h-full w-[min(56vw,760px)] max-w-[820px] min-w-[440px] flex-col border-l bg-background md:flex',
            desktopContainerClassName
          )}
        >
          <div className="min-h-0 flex-1">{content}</div>
        </div>
      )}

      {!isDesktop && (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-none">
            <div className="flex h-full flex-col">
              <div className="border-b px-5 py-4 pr-12">
                <SheetTitle>Artifacts</SheetTitle>
              </div>
              <div className="min-h-0 flex-1">{content}</div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
