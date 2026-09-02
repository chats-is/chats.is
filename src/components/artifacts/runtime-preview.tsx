import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';

import { type Artifact } from '@/types';
import { normalizeCodeLanguage } from '@/lib/code-language';
import { cn } from '@/lib/utils';
import { artifactRegistry } from '@/components/artifacts/registry';
import { MessageMarkdown } from '@/components/message-markdown';

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

type PreviewFile = {
  path: string;
  code: string;
  language?: string;
};

type PreviewRuntimeResponse = {
  entryPath?: string;
  files?: Record<string, string>;
  error?: string;
};

// Memoize compiled output by request body so identical content (common while
// streaming re-renders the same files) doesn't re-hit the compile endpoint.
type CompiledPreview = { entryPath: string; files: Record<string, string> };
const PREVIEW_CACHE_MAX = 64;
const previewResultCache = new Map<string, CompiledPreview>();

const previewCacheSet = (key: string, value: CompiledPreview) => {
  previewResultCache.set(key, value);
  if (previewResultCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewResultCache.keys().next().value;
    if (oldest !== undefined) previewResultCache.delete(oldest);
  }
};

const isPreviewableCodeLanguage = (artifact: Artifact) => {
  const normalized = normalizeCodeLanguage(artifact.language);
  const rawLanguage = artifact.language?.toLowerCase().trim();

  return (
    normalized === 'tsx' ||
    normalized === 'jsx' ||
    normalized === 'typescript' ||
    normalized === 'javascript' ||
    rawLanguage === 'react'
  );
};

const isHtmlLikeArtifact = (artifact: Artifact) => {
  if (artifact.type === 'html') return true;
  if (
    artifact.type === 'code' &&
    normalizeCodeLanguage(artifact.language) === 'svg'
  ) {
    return true;
  }
  return (
    artifact.type === 'code' &&
    normalizeCodeLanguage(artifact.language) === 'html'
  );
};

const StatusPanel = ({
  status,
  error
}: {
  status: PreviewStatus;
  error: string | null;
}) => {
  if (status === 'loading') {
    return (
      <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        Building preview...
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <AlertCircle className="size-4" />
          Preview failed
        </div>
        <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap">
          {error}
        </pre>
      </div>
    );
  }

  return null;
};

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
    .replace(/[^A-Za-z0-9._/-]/g, '-');
}

function looksLikeJsx(code: string) {
  return /<\s*[A-Za-z][\w:-]*(\s|\/?>)/.test(code) || /<>\s*/.test(code);
}

function getArtifactFileExtension(artifact: Artifact) {
  const normalized = normalizeCodeLanguage(artifact.language);
  const rawLanguage = artifact.language?.toLowerCase().trim();
  const content = artifact.content ?? '';

  if (artifact.fileName?.includes('.')) {
    return artifact.fileName.split('.').pop() ?? 'tsx';
  }

  if (rawLanguage === 'react') return 'tsx';
  if (normalized === 'typescript') return looksLikeJsx(content) ? 'tsx' : 'ts';
  if (normalized === 'javascript') return looksLikeJsx(content) ? 'jsx' : 'js';
  if (normalized === 'tsx' || normalized === 'jsx') return normalized;
  if (normalized) return normalized;
  return 'tsx';
}

function hasPathExtension(value: string) {
  const lastSegment = value.split('/').pop() ?? value;
  return /\.[A-Za-z0-9]+$/.test(lastSegment);
}

function extractLeadingFileName(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^([A-Za-z0-9_-][A-Za-z0-9._/-]*\.(?:tsx|ts|jsx|js|css|html|json|md))(?=$|\s|[-:])/
  );
  return match?.[1] ?? null;
}

function extractDefaultExportName(code: string) {
  const patterns = [
    /export\s+default\s+function\s+([A-Z]\w*)/,
    /export\s+default\s+class\s+([A-Z]\w*)/,
    /const\s+([A-Z]\w*)\s*=.*?[\r\n]+\s*export\s+default\s+\1/s,
    /function\s+([A-Z]\w*)\s*\([\s\S]*?[\r\n]+\s*export\s+default\s+\1/s
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function getArtifactVirtualPath(artifact: Artifact) {
  const candidate = sanitizePathSegment(
    artifact.fileName ||
      extractLeadingFileName(artifact.title) ||
      artifact.title ||
      artifact.id
  );
  const extension = getArtifactFileExtension(artifact);

  if (hasPathExtension(candidate)) {
    return candidate.startsWith('/') ? candidate : `/${candidate}`;
  }

  return `/${candidate || artifact.id}.${extension}`;
}

function getArtifactVirtualPaths(artifact: Artifact) {
  const extension = getArtifactFileExtension(artifact);
  const paths = new Set<string>([getArtifactVirtualPath(artifact)]);
  const exportName = extractDefaultExportName(artifact.content ?? '');

  if (exportName) {
    paths.add(`/${exportName}.${extension}`);
  }

  return Array.from(paths);
}

// Each artifact is an independent, self-contained file, so the preview is built
// from ONLY the selected artifact. (Merging every code artifact in the chat
// collided their identical entry paths — e.g. multiple `index.tsx` — and made
// switching show the wrong one.)
function buildPreviewFiles(artifact: Artifact): PreviewFile[] {
  if (artifact.type !== 'code' || !artifact.content) {
    return [];
  }

  return getArtifactVirtualPaths(artifact).map(path => ({
    path,
    code: artifact.content ?? '',
    language: artifact.language ?? undefined
  }));
}

function ReactArtifactPreview({
  artifact,
  consoleOpen,
  onConsoleOpenChange
}: {
  artifact: Artifact;
  consoleOpen?: boolean;
  onConsoleOpenChange?: (open: boolean) => void;
}) {
  // Use the live content directly (not deferred): the preview is never shown
  // while streaming, so changes are discrete (artifact switches, entering
  // preview). Deferring would let the entry path and the file contents come
  // from different content versions, producing a mismatched/failed compile.
  const content = artifact.content ?? '';
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [compiledFiles, setCompiledFiles] = useState<Record<
    string,
    string
  > | null>(null);
  const [entryPath, setEntryPath] = useState<string | null>(null);
  const iframeTitle = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Frame handshake state lives in refs so the once-bound message listener and
  // the post helper always see the latest values (no stale closures, no race
  // between the iframe load event and the frame's "ready" message).
  const frameReadyRef = useRef(false);
  const compiledRef = useRef<{
    files: Record<string, string>;
    entryPath: string;
  } | null>(null);
  const fallbackRef = useRef<number | null>(null);
  const [logs, setLogs] = useState<{ level: string; message: string }[]>([]);
  // Console open state is controlled when the parent passes onConsoleOpenChange
  // (the artifact header owns the toggle), otherwise managed locally.
  const isConsoleOpen = consoleOpen ?? false;
  const setConsoleOpen = (open: boolean) => {
    onConsoleOpenChange?.(open);
  };
  // The message listener effect runs once; read the latest setter via a ref so
  // error auto-open isn't stuck with a stale closure.
  const setConsoleOpenRef = useRef(setConsoleOpen);
  setConsoleOpenRef.current = setConsoleOpen;

  // The single place that pushes the latest compiled result into the frame.
  // Called both when a new result compiles AND when the frame (re)announces it
  // is ready — so no ordering can leave the frame without content.
  const postToFrame = useCallback(() => {
    const payload = compiledRef.current;
    if (!frameReadyRef.current || !payload) return;
    setLogs([]);
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'artifact-preview-render',
        entryPath: payload.entryPath,
        files: payload.files
      },
      '*'
    );
    if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
    // If the frame never reports back that it rendered, don't leave the loading
    // overlay stuck forever.
    fallbackRef.current = window.setTimeout(() => setStatus('ready'), 6000);
  }, []);
  const previewFiles = useMemo(
    () => buildPreviewFiles({ ...artifact, content }),
    [artifact, content]
  );
  const currentEntryPath = useMemo(
    () => getArtifactVirtualPath({ ...artifact, content }),
    [artifact, content]
  );

  // The compile request as a stable STRING. `previewFiles` gets a fresh array
  // reference on every benign re-render (e.g. when artifact queries
  // refetch), so keying the compile effect off it would needlessly re-run and
  // flash the loading overlay. Keying off the string value re-runs only when
  // the actual entry/content changes.
  const requestBody = useMemo(
    () =>
      content.trim()
        ? JSON.stringify({ entryPath: currentEntryPath, files: previewFiles })
        : '',
    [currentEntryPath, previewFiles, content]
  );

  useEffect(() => {
    if (!requestBody) {
      setStatus('idle');
      setError(null);
      setCompiledFiles(null);
      setEntryPath(null);
      return;
    }

    // Show the loading state immediately (synchronously, before the debounce)
    // so switching artifacts/content gives instant visible feedback — the
    // opaque overlay covers the old preview until the new one is built.
    setStatus('loading');
    setError(null);

    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      // Compilation done is NOT "ready": stay in loading until the frame posts
      // back that it has actually rendered the new content (see the message
      // listener), otherwise the overlay would lift before the new preview is
      // on screen and briefly show the old one.
      const cachedResult = previewResultCache.get(requestBody);
      if (cachedResult) {
        if (cancelled) return;
        setError(null);
        setCompiledFiles(cachedResult.files);
        setEntryPath(cachedResult.entryPath);
        return;
      }

      const response = await fetch('/api/artifacts/preview', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json'
        },
        body: requestBody
      });

      const result = (await response
        .json()
        .catch(() => null)) as PreviewRuntimeResponse | null;

      if (cancelled) return;

      if (!response.ok || !result?.files || !result?.entryPath) {
        setStatus('error');
        setError(result?.error ?? 'Failed to build preview');
        setCompiledFiles(null);
        setEntryPath(null);
        return;
      }

      previewCacheSet(requestBody, {
        entryPath: result.entryPath,
        files: result.files
      });

      setError(null);
      setCompiledFiles(result.files);
      setEntryPath(result.entryPath);
    };

    // Short debounce just to coalesce the few dep changes that fire together.
    const timeoutId = window.setTimeout(() => {
      void run();
    }, 80);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [requestBody]);

  useEffect(() => {
    const handleMessage = (
      event: MessageEvent<{ type?: string; level?: string; message?: string }>
    ) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'artifact-preview-frame-ready') {
        // The frame (re)loaded and can receive content; push the latest result.
        frameReadyRef.current = true;
        postToFrame();
        return;
      }
      if (event.data?.type === 'artifact-preview-rendered') {
        // New content is on screen — only now lift the loading overlay.
        if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
        setStatus('ready');
        return;
      }
      if (event.data?.type === 'artifact-preview-log' && event.data.message) {
        const { level, message } = event.data;
        setLogs(prev =>
          [...prev, { level: level ?? 'log', message }].slice(-50)
        );
        // Auto-open on errors so failures aren't hidden; the user can still
        // close it again afterwards.
        if (level === 'error') {
          setConsoleOpenRef.current(true);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [postToFrame]);

  // When a new result compiles, stash it and push it to the frame (a no-op until
  // the frame has announced ready, after which the ready handler pushes it).
  useEffect(() => {
    compiledRef.current =
      compiledFiles && entryPath ? { files: compiledFiles, entryPath } : null;
    postToFrame();
  }, [compiledFiles, entryPath, postToFrame]);

  // Keep the iframe mounted once we have a compiled result so re-compiles (e.g.
  // switching artifacts) update it in place via postMessage instead of tearing
  // down and reloading the frame (which is slow and shows stale content).
  const hasPreview = Boolean(compiledFiles && entryPath);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {hasPreview ? (
        <>
          <iframe
            ref={iframeRef}
            title={`artifact-react-preview-${iframeTitle}`}
            sandbox="allow-scripts"
            className="min-h-0 w-full flex-1 bg-white"
            src="/artifact-preview-frame"
          />
          {isConsoleOpen && (
            <div className="max-h-40 shrink-0 overflow-auto border-t bg-muted/30 p-2 font-mono text-xs">
              {logs.length > 0 ? (
                logs.map((entry, index) => (
                  <pre
                    key={index}
                    className={cn(
                      'wrap-break-word whitespace-pre-wrap',
                      entry.level === 'error' && 'text-destructive',
                      entry.level === 'warn' &&
                        'text-amber-600 dark:text-amber-500'
                    )}
                  >
                    {entry.message}
                  </pre>
                ))
              ) : (
                <div className="text-muted-foreground">No console output.</div>
              )}
            </div>
          )}
        </>
      ) : (
        status !== 'ready' && <StatusPanel status={status} error={error} />
      )}
      {hasPreview && status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          Building preview...
        </div>
      )}
    </div>
  );
}

export function supportsArtifactRuntimePreview(artifact: Artifact) {
  if (isHtmlLikeArtifact(artifact)) return true;
  if (artifact.type === 'markdown') return true;
  if (artifact.type === 'json') return true;
  if (artifact.type === 'code' && isPreviewableCodeLanguage(artifact)) {
    return true;
  }
  return false;
}

export function isReactCodePreview(artifact: Artifact) {
  return artifact.type === 'code' && isPreviewableCodeLanguage(artifact);
}

export function ArtifactRuntimePreview({
  artifact,
  consoleOpen,
  onConsoleOpenChange
}: {
  artifact: Artifact;
  consoleOpen?: boolean;
  onConsoleOpenChange?: (open: boolean) => void;
}) {
  const iframeTitle = useId();
  const htmlSource = useMemo(() => {
    // Inject a strict CSP so self-contained HTML/SVG previews can use inline
    // script/style but cannot reach the network (no exfiltration). The meta must
    // sit inside <head> to be honored — placing it before <!DOCTYPE>/<html>
    // would force quirks mode and be ignored.
    const csp =
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; " +
      "connect-src 'none'";
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const content = artifact.content ?? '';

    // A self-closing <head/> must be expanded first — the open-tag regex below
    // would match it and drop the meta OUTSIDE the head, where browsers ignore
    // an http-equiv CSP entirely.
    if (/<head[^>]*\/>/i.test(content)) {
      return content.replace(
        /<head([^>]*)\/>/i,
        (_match, attrs: string) => `<head${attrs}>${meta}</head>`
      );
    }
    if (/<head[^>]*>/i.test(content)) {
      return content.replace(/(<head[^>]*>)/i, `$1${meta}`);
    }
    if (/<html[^>]*>/i.test(content)) {
      return content.replace(/(<html[^>]*>)/i, `$1<head>${meta}</head>`);
    }
    return `<!DOCTYPE html><html><head>${meta}</head><body>${content}</body></html>`;
  }, [artifact.content]);

  if (artifact.type === 'markdown') {
    return (
      <div className="h-full overflow-auto rounded-md border bg-background p-4">
        <MessageMarkdown content={artifact.content ?? ''} />
      </div>
    );
  }

  if (artifact.type === 'json') {
    return (
      <div className="h-full overflow-auto rounded-md border bg-background">
        {artifactRegistry.sheet.renderContent(artifact)}
      </div>
    );
  }

  if (isHtmlLikeArtifact(artifact)) {
    return (
      <iframe
        title={`artifact-preview-${iframeTitle}`}
        sandbox="allow-scripts"
        className="size-full min-h-0 bg-white"
        srcDoc={htmlSource}
      />
    );
  }

  if (artifact.type === 'code' && isPreviewableCodeLanguage(artifact)) {
    return (
      <ReactArtifactPreview
        artifact={artifact}
        consoleOpen={consoleOpen}
        onConsoleOpenChange={onConsoleOpenChange}
      />
    );
  }

  return (
    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
      Preview is not available for this artifact.
    </div>
  );
}
