import { Code2, File, FileText, Image as ImageIcon, Table } from 'lucide-react'

import { type Artifact } from '@/types'
import { getArtifactKind, type ArtifactKind } from '@/lib/artifact'
import { getArtifactLanguageLabel } from '@/lib/code-language'
import { CodeBlock } from '@/components/codeblock'
import { MessageMarkdown } from '@/components/message-markdown'

export { getArtifactLanguageLabel } from '@/lib/code-language'
export { getArtifactKind, type ArtifactKind } from '@/lib/artifact'

const isImageMime = (mimeType?: string | null) =>
  !!mimeType && mimeType.startsWith('image/')
const isVideoMime = (mimeType?: string | null) =>
  !!mimeType && mimeType.startsWith('video/')
const isAudioMime = (mimeType?: string | null) =>
  !!mimeType && mimeType.startsWith('audio/')
const isPdfMime = (mimeType?: string | null) => mimeType === 'application/pdf'

const formatCell = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// The one shared "raw source" surface (also the streaming fallback for sheets),
// so every source view renders identically.
const renderRawSource = (artifact: Artifact, language: string) => (
  <CodeBlock
    language={language}
    value={artifact.content ?? ''}
    autoScrollToBottom={artifact.status === 'streaming'}
    showHeader={false}
    wrapLongLines={true}
    bordered={false}
  />
)

// Whether the source view should use the flush code surface (no padding) vs.
// the bordered document card. Owned here so the viewer needs no per-type checks.
export const artifactSourceUsesCodeChrome = (artifact: Artifact) => {
  const kind = getArtifactKind(artifact)
  return kind === 'code' || kind === 'sheet' || artifact.type === 'markdown'
}

// Renders a JSON ("sheet") artifact as a real table when the content is an
// array of row objects/arrays; otherwise (incl. partial content while
// streaming) falls back to syntax-highlighted JSON.
function SheetContent({ artifact }: { artifact: Artifact }) {
  const content = artifact.content ?? ''

  let parsed: unknown = null
  try {
    parsed = JSON.parse(content)
  } catch {
    parsed = null
  }

  const rows = Array.isArray(parsed) ? parsed : null
  const jsonFallback = renderRawSource(artifact, 'json')

  if (!rows || rows.length === 0) {
    return jsonFallback
  }

  const allObjects = rows.every(
    (row) => row != null && typeof row === 'object' && !Array.isArray(row),
  )
  const allArrays = rows.every((row) => Array.isArray(row))

  if (!allObjects && !allArrays) {
    return jsonFallback
  }

  const columns = allObjects
    ? Array.from(
        new Set(
          rows.flatMap((row) => Object.keys(row as Record<string, unknown>)),
        ),
      )
    : Array.from({
        length: rows.reduce(
          (max, row) => Math.max(max, (row as unknown[]).length),
          0,
        ),
      })

  return (
    <div className="overflow-auto p-2">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {columns.map((column, index) => (
              <th key={index} className="px-3 py-2 font-medium">
                {allObjects ? String(column) : `#${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b last:border-0">
              {columns.map((column, columnIndex) => (
                <td
                  key={columnIndex}
                  className="px-3 py-2 align-top whitespace-pre-wrap"
                >
                  {allObjects
                    ? formatCell(
                        (row as Record<string, unknown>)[column as string],
                      )
                    : formatCell((row as unknown[])[columnIndex])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const renderImageContent = (artifact: Artifact) =>
  artifact.fileUrl ? (
    <img
      className="max-h-[480px] w-auto rounded-md"
      src={artifact.fileUrl}
      alt={artifact.title}
    />
  ) : (
    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
      Image URL unavailable.
    </div>
  )

const renderFileContent = (artifact: Artifact) => {
  if (artifact.fileUrl && isImageMime(artifact.mimeType)) {
    return (
      <img
        className="max-h-[480px] w-auto rounded-md"
        src={artifact.fileUrl}
        alt={artifact.title}
      />
    )
  }

  if (artifact.fileUrl && isVideoMime(artifact.mimeType)) {
    return (
      <video
        className="max-h-[480px] w-auto rounded-md"
        controls
        src={artifact.fileUrl}
      />
    )
  }

  if (artifact.fileUrl && isAudioMime(artifact.mimeType)) {
    return <audio className="w-full" controls src={artifact.fileUrl} />
  }

  if (artifact.fileUrl && isPdfMime(artifact.mimeType)) {
    return (
      <iframe
        className="h-[70vh] w-full rounded-md border"
        src={artifact.fileUrl}
        title={artifact.title}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="truncate">{artifact.fileName || 'File'}</div>
      {artifact.mimeType && (
        <div className="text-xs text-muted-foreground">{artifact.mimeType}</div>
      )}
      {!artifact.fileUrl && (
        <div className="text-xs text-muted-foreground">
          File URL unavailable.
        </div>
      )}
      {artifact.fileUrl && (
        <a
          href={artifact.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-primary"
        >
          Download
        </a>
      )}
    </div>
  )
}

export const artifactRegistry: Record<
  ArtifactKind,
  {
    label: string
    icon: typeof FileText
    renderPreview: (artifact: Artifact) => React.ReactNode
    renderContent: (artifact: Artifact) => React.ReactNode
    /** Raw text form shown in the source view (media kinds reuse renderContent). */
    renderSource: (artifact: Artifact) => React.ReactNode
  }
> = {
  text: {
    label: 'Text',
    icon: FileText,
    renderPreview: (artifact) => (
      <div className="line-clamp-3 text-xs text-muted-foreground">
        {artifact.content ?? ''}
      </div>
    ),
    renderContent: (artifact) => {
      if (artifact.type === 'markdown') {
        return <MessageMarkdown content={artifact.content ?? ''} />
      }
      return (
        <pre className="text-sm whitespace-pre-wrap">
          {artifact.content ?? ''}
        </pre>
      )
    },
    renderSource: (artifact) =>
      artifact.type === 'markdown' ? (
        renderRawSource(artifact, 'markdown')
      ) : (
        <pre className="text-sm whitespace-pre-wrap">
          {artifact.content ?? ''}
        </pre>
      ),
  },
  code: {
    label: 'Code',
    icon: Code2,
    renderPreview: (artifact) => (
      <pre className="line-clamp-3 overflow-hidden font-mono text-xs whitespace-pre-wrap text-muted-foreground">
        {artifact.content ?? ''}
      </pre>
    ),
    renderContent: (artifact) =>
      renderRawSource(artifact, getArtifactLanguageLabel(artifact)),
    renderSource: (artifact) =>
      renderRawSource(artifact, getArtifactLanguageLabel(artifact)),
  },
  sheet: {
    label: 'Sheet',
    icon: Table,
    renderPreview: (artifact) => {
      try {
        const rows = JSON.parse(artifact.content ?? '[]')
        if (Array.isArray(rows)) {
          return (
            <div className="text-xs text-muted-foreground">
              {rows.length} rows
            </div>
          )
        }
      } catch {}
      return <div className="text-xs text-muted-foreground">Invalid JSON</div>
    },
    renderContent: (artifact) => <SheetContent artifact={artifact} />,
    renderSource: (artifact) => renderRawSource(artifact, 'json'),
  },
  image: {
    label: 'Image',
    icon: ImageIcon,
    renderPreview: (artifact) =>
      artifact.fileUrl ? (
        <img
          className="h-20 w-full rounded-md object-cover"
          src={artifact.fileUrl}
          alt={artifact.title}
        />
      ) : (
        <div className="text-xs text-muted-foreground">No image</div>
      ),
    renderContent: renderImageContent,
    renderSource: renderImageContent,
  },
  file: {
    label: 'File',
    icon: File,
    renderPreview: (artifact) => {
      if (artifact.fileUrl && isImageMime(artifact.mimeType)) {
        return (
          <img
            className="h-20 w-full rounded-md object-cover"
            src={artifact.fileUrl}
            alt={artifact.title}
          />
        )
      }
      return (
        <div className="text-xs text-muted-foreground">
          {artifact.fileName ||
            (artifact.fileUrl ? 'File' : 'File URL unavailable')}
        </div>
      )
    },
    renderContent: renderFileContent,
    renderSource: renderFileContent,
  },
}
