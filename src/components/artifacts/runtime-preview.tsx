import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';
import { useMatch } from '@tanstack/react-router';
import { AlertCircle, LoaderCircle, Wrench } from 'lucide-react';

import { type Artifact } from '@/types';
import { buildPreviewFiles, getArtifactVirtualPath } from '@/lib/artifact';
import { normalizeCodeLanguage } from '@/lib/code-language';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { artifactRegistry } from '@/components/artifacts/registry';
import { MessageMarkdown } from '@/components/message-markdown';

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

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

type PreviewLog = { level: string; message: string };

/**
 * Hands an error to the chat to be fixed. Once per press of a given error: a
 * double press would send the message twice before the turn has begun and
 * the panel has taken the button away.
 */
const FixButton = ({
  error,
  onFix
}: {
  error: string;
  onFix: (error: string) => void;
}) => {
  const [sentFor, setSentFor] = useState<string | null>(null);

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 shrink-0 gap-1.5 font-sans text-xs"
      disabled={sentFor === error}
      onClick={() => {
        setSentFor(error);
        onFix(error);
      }}
    >
      <Wrench className="size-3.5" />
      Try fixing
    </Button>
  );
};

const StatusPanel = ({
  status,
  error,
  onFix
}: {
  status: PreviewStatus;
  error: string | null;
  onFix?: (error: string) => void;
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
          {error && onFix && (
            <span className="ml-auto">
              <FixButton error={error} onFix={onFix} />
            </span>
          )}
        </div>
        <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap">
          {error}
        </pre>
      </div>
    );
  }

  return null;
};

/**
 * What a preview frame logs, kept for its console. Only from `frameRef`'s
 * own window: any frame can post a message to this page. An error opens the
 * console, so a failure is not left hidden behind a closed panel.
 */
function usePreviewLogs(
  frameRef: React.RefObject<HTMLIFrameElement | null>,
  onConsoleOpenChange?: (open: boolean) => void
) {
  const [logs, setLogs] = useState<PreviewLog[]>([]);
  // The listener is bound once; the latest setter is read through a ref.
  const openRef = useRef(onConsoleOpenChange);
  openRef.current = onConsoleOpenChange;

  useEffect(() => {
    const handleMessage = (
      event: MessageEvent<{ type?: string; level?: string; message?: string }>
    ) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type !== 'artifact-preview-log' || !event.data.message) {
        return;
      }
      const { level, message } = event.data;
      setLogs(prev => [...prev, { level: level ?? 'log', message }].slice(-50));
      if (level === 'error') {
        openRef.current?.(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [frameRef]);

  return { logs, clearLogs: useCallback(() => setLogs([]), []) };
}

function PreviewConsole({
  logs,
  onFix
}: {
  logs: PreviewLog[];
  onFix?: (error: string) => void;
}) {
  const lastError = logs
    .filter(entry => entry.level === 'error')
    .at(-1)?.message;

  return (
    <div className="max-h-40 shrink-0 overflow-auto border-t bg-muted/30 p-2 font-mono text-xs">
      {lastError && onFix && (
        <div className="mb-1 flex justify-end">
          <FixButton error={lastError} onFix={onFix} />
        </div>
      )}
      {logs.length > 0 ? (
        logs.map((entry, index) => (
          <pre
            key={index}
            className={cn(
              'wrap-break-word whitespace-pre-wrap',
              entry.level === 'error' && 'text-destructive',
              entry.level === 'warn' && 'text-amber-600 dark:text-amber-500'
            )}
          >
            {entry.message}
          </pre>
        ))
      ) : (
        <div className="text-muted-foreground">No console output.</div>
      )}
    </div>
  );
}

function ReactArtifactPreview({
  artifact,
  consoleOpen,
  onConsoleOpenChange,
  onFix
}: {
  artifact: Artifact;
  consoleOpen?: boolean;
  onConsoleOpenChange?: (open: boolean) => void;
  onFix?: (error: string) => void;
}) {
  // Use the live content directly (not deferred): the preview is never shown
  // while streaming, so changes are discrete (artifact switches, entering
  // preview). Deferring would let the entry path and the file contents come
  // from different content versions, producing a mismatched/failed compile.
  const content = artifact.content ?? '';
  // On a share page there is no session, and the link stands in for one: the
  // request names it and the artifact, and the server checks that the one is
  // in the chat the other opens. The link's id is in the address.
  const shareId = useMatch({
    from: '/share/$id',
    shouldThrow: false,
    select: match => match.params.id
  });
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
  const { logs, clearLogs } = usePreviewLogs(iframeRef, onConsoleOpenChange);
  // The artifact header owns the console toggle.
  const isConsoleOpen = consoleOpen ?? false;

  // The single place that pushes the latest compiled result into the frame.
  // Called both when a new result compiles AND when the frame (re)announces it
  // is ready — so no ordering can leave the frame without content.
  const postToFrame = useCallback(() => {
    const payload = compiledRef.current;
    if (!frameReadyRef.current || !payload) return;
    clearLogs();
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
  }, [clearLogs]);
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
        ? JSON.stringify({
            entryPath: currentEntryPath,
            files: previewFiles,
            ...(shareId && { share: { id: shareId, artifactId: artifact.id } })
          })
        : '',
    [currentEntryPath, previewFiles, content, shareId, artifact.id]
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
    const handleMessage = (event: MessageEvent<{ type?: string }>) => {
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
          {isConsoleOpen && <PreviewConsole logs={logs} onFix={onFix} />}
        </>
      ) : (
        status !== 'ready' && (
          <StatusPanel status={status} error={error} onFix={onFix} />
        )
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

function isReactCodePreview(artifact: Artifact) {
  return artifact.type === 'code' && isPreviewableCodeLanguage(artifact);
}

/** Whether the artifact's preview has a console: it runs in a frame of ours. */
export function hasPreviewConsole(artifact: Artifact) {
  return isReactCodePreview(artifact) || isHtmlLikeArtifact(artifact);
}

// Runs ahead of the artifact's own scripts and says what goes wrong to the
// page, in the messages the React frame sends — so an HTML artifact has the
// same console, and the same fix, as a React one.
const HTML_ERROR_REPORTER = `<script>(function () {
  function send(level, message) {
    try { parent.postMessage({ type: 'artifact-preview-log', level: level, message: message }, '*'); } catch (e) {}
  }
  function text(args) {
    return Array.prototype.map.call(args, function (arg) {
      if (arg instanceof Error) return arg.message;
      if (typeof arg === 'string') return arg;
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }).join(' ');
  }
  window.addEventListener('error', function (event) {
    send('error', event.message || 'Script error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    send('error', text([event.reason]));
  });
  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      send(level, text(arguments));
      original.apply(console, arguments);
    };
  });
})();</script>`;

function HtmlArtifactPreview({
  content,
  consoleOpen,
  onConsoleOpenChange,
  onFix
}: {
  content: string;
  consoleOpen?: boolean;
  onConsoleOpenChange?: (open: boolean) => void;
  onFix?: (error: string) => void;
}) {
  const iframeTitle = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { logs, clearLogs } = usePreviewLogs(iframeRef, onConsoleOpenChange);
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

    // The policy goes in a head of our own, ahead of everything the artifact
    // wrote. Finding the artifact's <head> to put it in means reading HTML
    // with a pattern, and the first `<head>` in the text need not be a tag —
    // inside a comment it takes the policy with it, and the page runs with
    // none. A parser that meets a second <html>, <head> or <body> keeps their
    // contents and folds their attributes into the ones it has, so the
    // document renders as written, under a policy it had no part in placing.
    return `<!DOCTYPE html><html><head>${meta}${HTML_ERROR_REPORTER}</head><body>${content}</body></html>`;
  }, [content]);

  // New source is a new page: what the last one logged no longer applies.
  useEffect(() => {
    clearLogs();
  }, [htmlSource, clearLogs]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <iframe
        ref={iframeRef}
        title={`artifact-preview-${iframeTitle}`}
        sandbox="allow-scripts"
        className="min-h-0 w-full flex-1 bg-white"
        srcDoc={htmlSource}
      />
      {consoleOpen && <PreviewConsole logs={logs} onFix={onFix} />}
    </div>
  );
}

export function ArtifactRuntimePreview({
  artifact,
  consoleOpen,
  onConsoleOpenChange,
  onFix
}: {
  artifact: Artifact;
  consoleOpen?: boolean;
  onConsoleOpenChange?: (open: boolean) => void;
  /** Absent where nobody can send a message: a share page. */
  onFix?: (error: string) => void;
}) {
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
      <HtmlArtifactPreview
        content={artifact.content ?? ''}
        consoleOpen={consoleOpen}
        onConsoleOpenChange={onConsoleOpenChange}
        onFix={onFix}
      />
    );
  }

  if (artifact.type === 'code' && isPreviewableCodeLanguage(artifact)) {
    return (
      <ReactArtifactPreview
        artifact={artifact}
        consoleOpen={consoleOpen}
        onConsoleOpenChange={onConsoleOpenChange}
        onFix={onFix}
      />
    );
  }

  return (
    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
      Preview is not available for this artifact.
    </div>
  );
}
