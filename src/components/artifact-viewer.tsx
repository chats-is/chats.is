import { useEffect, useRef, useState } from 'react';
import { CodeXml, Eye, LoaderCircle, X } from 'lucide-react';
import { toast } from 'sonner';

import { type Artifact } from '@/types';
import { formatAgo } from '@/lib/format-date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { ArtifactActionsMenu } from '@/components/artifacts/artifact-actions-menu';
import {
  artifactRegistry,
  artifactSourceUsesCodeChrome,
  getArtifactKind,
  getArtifactLanguageLabel
} from '@/components/artifacts/registry';
import {
  ArtifactRuntimePreview,
  supportsArtifactRuntimePreview
} from '@/components/artifacts/runtime-preview';
import { SelectionEdit } from '@/components/artifacts/selection-edit';

interface ArtifactViewerProps {
  artifact?: Artifact;
  artifacts?: Artifact[];
  onSelectArtifact?: (id: string) => void;
  onClose?: () => void;
  hideHeader?: boolean;
  hideContent?: boolean;
  viewMode?: 'source' | 'preview';
  onViewModeChange?: (mode: 'source' | 'preview') => void;
  /** Asks the chat to fix an error in the artifact's preview. */
  onFix?: (artifact: Artifact, error: string) => void;
  /** Asks the chat about a passage selected in the artifact's source. */
  onEdit?: (artifact: Artifact, selection: string, request: string) => void;
  /** Offers to share the artifact on its own: in the chat, between turns. */
  canShare?: boolean;
  /** False while it may still be changing: in its chat, during a turn. */
  canDuplicate?: boolean;
}

export function ArtifactViewer({
  artifact,
  artifacts = [],
  onSelectArtifact,
  onClose,
  hideHeader,
  hideContent,
  viewMode: controlledViewMode,
  onViewModeChange,
  onFix,
  onEdit,
  canShare,
  canDuplicate
}: ArtifactViewerProps) {
  const [uncontrolledViewMode, setUncontrolledViewMode] = useState<
    'source' | 'preview'
  >('source');
  const contentRef = useRef<HTMLDivElement>(null);
  const viewMode = controlledViewMode ?? uncontrolledViewMode;

  const status = artifact?.status;
  const artifactId = artifact?.id;
  const artifactContent = artifact?.content;

  // Keep the streaming view scrolled to the bottom. Declared before the
  // early return below so the hook order stays stable when `artifact` toggles
  // between defined and undefined (Rules of Hooks).
  useEffect(() => {
    if (hideContent) return;
    if (!contentRef.current) return;
    if (status !== 'streaming') return;

    requestAnimationFrame(() => {
      if (!contentRef.current) return;
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    });
  }, [artifactContent, artifactId, hideContent, status]);

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an artifact to view.
      </div>
    );
  }

  const kind = getArtifactKind(artifact);
  const registry = artifactRegistry[kind];
  const isStreaming = artifact.status === 'streaming';
  const supportsPreview =
    !isStreaming && supportsArtifactRuntimePreview(artifact);
  const languageLabel =
    kind === 'code' || kind === 'text'
      ? getArtifactLanguageLabel(artifact)
      : '';
  const headerActionButtonClassName = 'size-7 text-muted-foreground';
  const isHeaderActionDisabled = isStreaming;
  const canDownload = Boolean(artifact.content);

  // Source view = the registry's raw text form; preview view = the runtime
  // preview (iframe / markdown / sheet table). The registry owns both per kind,
  // so the viewer needs no per-type branches.
  const sourceContent = (
    <div
      ref={contentRef}
      className={cn(
        'relative h-full min-h-0 overflow-auto bg-background',
        artifactSourceUsesCodeChrome(artifact) ? 'p-0' : 'p-4'
      )}
    >
      {registry.renderSource(artifact)}
      {onEdit && !isStreaming && (
        <SelectionEdit
          key={artifact.id}
          containerRef={contentRef}
          onSubmit={(selection, request) =>
            onEdit(artifact, selection, request)
          }
        />
      )}
    </div>
  );

  const previewContent = (
    <div className="h-full min-h-0 overflow-auto bg-background">
      <ArtifactRuntimePreview
        artifact={artifact}
        onFix={onFix && (error => onFix(artifact, error))}
      />
    </div>
  );

  const content = !supportsPreview
    ? sourceContent
    : viewMode === 'preview'
      ? previewContent
      : sourceContent;

  const handleDownload = () => {
    if (!artifact.content) {
      toast.error('Nothing to download');
      return;
    }

    const extension =
      artifact.type === 'json'
        ? 'json'
        : artifact.type === 'html'
          ? 'html'
          : artifact.type === 'markdown'
            ? 'md'
            : artifact.language || 'txt';
    const blob = new Blob([artifact.content], {
      type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${artifact.title}.${extension}`.replace(/\s+/g, '-');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const viewModeButtons = supportsPreview ? (
    <div className="relative flex shrink-0 items-center rounded-full border border-border/60 bg-transparent p-0.5">
      <div
        className={cn(
          'absolute inset-y-0.5 left-0.5 w-7 rounded-full bg-accent transition-transform',
          viewMode === 'preview' ? 'translate-x-0' : 'translate-x-7'
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'relative z-10 size-7 rounded-full bg-transparent text-muted-foreground hover:bg-transparent hover:text-accent-foreground',
          viewMode === 'preview' &&
            'text-accent-foreground hover:text-accent-foreground'
        )}
        onClick={() => {
          if (controlledViewMode === undefined) {
            setUncontrolledViewMode('preview');
          }
          onViewModeChange?.('preview');
        }}
      >
        <Eye className="size-4" />
        <span className="sr-only">Preview view</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'relative z-10 size-7 rounded-full bg-transparent text-muted-foreground hover:bg-transparent hover:text-accent-foreground',
          viewMode === 'source' &&
            'text-accent-foreground hover:text-accent-foreground'
        )}
        onClick={() => {
          if (controlledViewMode === undefined) {
            setUncontrolledViewMode('source');
          }
          onViewModeChange?.('source');
        }}
      >
        <CodeXml className="size-4" />
        <span className="sr-only">Code view</span>
      </Button>
    </div>
  ) : null;

  return (
    <div className="flex size-full min-h-0 flex-col justify-center gap-3">
      {!hideHeader && (
        <div className="relative flex gap-3">
          <div className="flex max-w-full min-w-0 items-center gap-2 pr-28">
            {viewModeButtons}
            {isStreaming && (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
            {artifacts.length > 1 ? (
              <Select
                value={artifact.id}
                onValueChange={value => onSelectArtifact?.(value)}
                disabled={isHeaderActionDisabled}
              >
                <SelectTrigger className="h-6 w-fit max-w-full min-w-0 border-0 p-0 text-sm font-semibold shadow-none">
                  <div className="flex min-w-0 items-center gap-2">
                    <SelectValue>
                      <span className="truncate">{artifact.title}</span>
                    </SelectValue>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {languageLabel || artifact.type}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent align="start">
                  {artifacts.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {/* Each change is a version of its own, under the
                          same title: when it was made tells them apart. */}
                      <div className="flex min-w-0 flex-col">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{item.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {getArtifactLanguageLabel(item) || item.type}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Updated {formatAgo(item.updatedAt)}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm font-semibold">
                  {artifact.title}
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {languageLabel || artifact.type}
                </div>
              </div>
            )}
          </div>
          <div className="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-2">
            <ArtifactActionsMenu
              artifact={artifact}
              disabled={isHeaderActionDisabled}
              onDownload={canDownload ? handleDownload : undefined}
              canShare={canShare}
              canDuplicate={canDuplicate}
              className={headerActionButtonClassName}
            />
            {onClose && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={headerActionButtonClassName}
                    disabled={isHeaderActionDisabled}
                    onClick={onClose}
                  >
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      {!hideContent && content}
    </div>
  );
}
