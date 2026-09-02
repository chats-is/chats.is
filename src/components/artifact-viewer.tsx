import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  CodeXml,
  Copy,
  Download,
  Eye,
  LoaderCircle,
  X
} from 'lucide-react';
import { toast } from 'sonner';

import { type Artifact } from '@/types';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
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

interface ArtifactViewerProps {
  artifact?: Artifact;
  artifacts?: Artifact[];
  onSelectArtifact?: (id: string) => void;
  onClose?: () => void;
  hideHeader?: boolean;
  hideContent?: boolean;
  viewMode?: 'source' | 'preview';
  onViewModeChange?: (mode: 'source' | 'preview') => void;
  extraActions?: React.ReactNode;
  consoleOpen?: boolean;
  onConsoleOpenChange?: (open: boolean) => void;
}

const isFileArtifact = (artifact?: Artifact) =>
  artifact?.type === 'image' || artifact?.type === 'file';

export function ArtifactViewer({
  artifact,
  artifacts = [],
  onSelectArtifact,
  onClose,
  hideHeader,
  hideContent,
  viewMode: controlledViewMode,
  onViewModeChange,
  extraActions,
  consoleOpen,
  onConsoleOpenChange
}: ArtifactViewerProps) {
  const { copyToClipboard } = useCopyToClipboard();
  const [uncontrolledViewMode, setUncontrolledViewMode] = useState<
    'source' | 'preview'
  >('source');
  const contentRef = useRef<HTMLDivElement>(null);
  const viewMode = controlledViewMode ?? uncontrolledViewMode;

  const status = artifact?.status;
  const artifactId = artifact?.id;
  const artifactContent = artifact?.content;
  const artifactFileUrl = artifact?.fileUrl;

  // Keep the streaming/done view scrolled to the bottom. Declared before the
  // early return below so the hook order stays stable when `artifact` toggles
  // between defined and undefined (Rules of Hooks).
  useEffect(() => {
    if (hideContent) return;
    if (!contentRef.current) return;
    if (status !== 'streaming' && status !== 'done') return;

    requestAnimationFrame(() => {
      if (!contentRef.current) return;
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    });
  }, [artifactContent, artifactFileUrl, artifactId, hideContent, status]);

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an artifact to view.
      </div>
    );
  }

  const isFile = isFileArtifact(artifact);
  const canCopyContent = !isFile && !!(artifact.content ?? '').trim();
  const kind = getArtifactKind(artifact);
  const registry = artifactRegistry[kind];
  const isStreaming = artifact.status === 'streaming';
  const isDone = artifact.status === 'done';
  const supportsPreview =
    !isStreaming && supportsArtifactRuntimePreview(artifact);
  const languageLabel =
    kind === 'code' || kind === 'text'
      ? getArtifactLanguageLabel(artifact)
      : '';
  const headerActionButtonClassName = 'size-7 text-muted-foreground';
  const isHeaderActionDisabled = isStreaming;
  const canDownload = Boolean(artifact.fileUrl || artifact.content);

  const statusIndicator = isStreaming ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground">
      <LoaderCircle className="size-3 animate-spin" />
      Streaming...
    </span>
  ) : isDone ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="size-3" />
      Done
    </span>
  ) : null;

  // Source view = the registry's raw text form; preview view = the runtime
  // preview (iframe / markdown / sheet table). The registry owns both per kind,
  // so the viewer needs no per-type branches.
  const sourceContent = (
    <div
      ref={contentRef}
      className={cn(
        'h-full min-h-0 overflow-auto rounded-md bg-background',
        artifactSourceUsesCodeChrome(artifact) ? 'p-0' : 'border p-4'
      )}
    >
      {registry.renderSource(artifact)}
    </div>
  );

  const previewContent = (
    <div className="h-full min-h-0 overflow-auto rounded-md bg-background">
      <ArtifactRuntimePreview
        artifact={artifact}
        consoleOpen={consoleOpen}
        onConsoleOpenChange={onConsoleOpenChange}
      />
    </div>
  );

  const content = !supportsPreview
    ? sourceContent
    : viewMode === 'preview'
      ? previewContent
      : sourceContent;

  const handleDownload = () => {
    if (artifact.fileUrl) {
      const link = document.createElement('a');
      link.href = artifact.fileUrl;
      link.target = '_blank';
      link.download = artifact.fileName || artifact.title;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

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
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {getArtifactLanguageLabel(item) || item.type}
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
            {statusIndicator}
          </div>
          <div className="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-2">
            {extraActions}
            {canCopyContent && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={headerActionButtonClassName}
                      disabled={isHeaderActionDisabled}
                      onClick={async () => {
                        await copyToClipboard(artifact.content ?? '');
                        toast.success('Copied');
                      }}
                    >
                      <Copy className="size-4" />
                      <span className="sr-only">Copy artifact</span>
                    </Button>
                  }
                />
                <TooltipContent>Copy</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={headerActionButtonClassName}
                    disabled={isHeaderActionDisabled || !canDownload}
                    onClick={handleDownload}
                  >
                    <Download className="size-4" />
                    <span className="sr-only">Download artifact</span>
                  </Button>
                }
              />
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
            {onClose && (
              <Tooltip>
                <TooltipTrigger
                  render={
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
                  }
                />
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
