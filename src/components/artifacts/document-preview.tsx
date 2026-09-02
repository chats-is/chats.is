import { Download } from 'lucide-react';

import { type Artifact } from '@/types';
import { downloadArtifact } from '@/lib/download';
import { cn } from '@/lib/utils';
import {
  artifactRegistry,
  getArtifactKind,
  getArtifactLanguageLabel
} from '@/components/artifacts/registry';

interface DocumentPreviewProps {
  artifact: Artifact;
  onOpen?: (id: string) => void;
  hidePreview?: boolean;
  showDownloadButton?: boolean;
}

export function DocumentPreview({
  artifact,
  onOpen,
  hidePreview,
  showDownloadButton
}: DocumentPreviewProps) {
  const kind = getArtifactKind(artifact);
  const registry = artifactRegistry[kind];
  const Icon = registry.icon;
  const languageLabel =
    kind === 'code' || kind === 'text'
      ? getArtifactLanguageLabel(artifact)
      : '';
  const canDownload = Boolean(artifact.fileUrl || artifact.content);

  const handleDownload = () => downloadArtifact(artifact);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'w-full rounded-lg border bg-background px-3 py-2.5 text-left transition hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden'
      )}
      onClick={() => onOpen?.(artifact.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(artifact.id);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="truncate text-sm font-medium">{artifact.title}</div>
          <div className="shrink-0 text-xs text-muted-foreground">
            {languageLabel || registry.label}
          </div>
        </div>
        {showDownloadButton ? (
          <button
            type="button"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            disabled={!canDownload}
            onClick={event => {
              event.stopPropagation();
              handleDownload();
            }}
          >
            <Download className="size-4" />
            <span className="sr-only">Download artifact</span>
          </button>
        ) : (
          <Download className="ml-auto size-4 text-muted-foreground opacity-50" />
        )}
      </div>
      {!hidePreview && (
        <div className="mt-2">{registry.renderPreview(artifact)}</div>
      )}
    </div>
  );
}
