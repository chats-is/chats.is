import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react';
import { useMatch } from '@tanstack/react-router';
import { ArtifactFilesContext } from '@/contexts/artifact-files-context';
import { LoaderCircle, Wrench, X } from 'lucide-react';

import { type Artifact, type PreviewPackage } from '@/types';
import {
  buildPreviewFiles,
  getArtifactVirtualPath,
  isHtmlPreviewArtifact
} from '@/lib/artifact';
import { normalizeCodeLanguage } from '@/lib/code-language';
import { HTML_PREVIEW_CDN } from '@/lib/constant';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { artifactRegistry } from '@/components/artifacts/registry';
import { MessageMarkdown } from '@/components/message-markdown';

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

type PreviewRuntimeResponse = {
  entryPath?: string;
  files?: Record<string, string>;
  imports?: PreviewPackage[];
  error?: string;
};

// Memoize compiled output by request body so identical content (common while
// streaming re-renders the same files) doesn't re-hit the compile endpoint.
type CompiledPreview = {
  entryPath: string;
  files: Record<string, string>;
  imports: PreviewPackage[];
};

/** What the frame is sent to show: a compiled build, or a Mermaid diagram. */
type FramePayload =
  | ({ type: 'artifact-preview-render' } & CompiledPreview)
  | { type: 'artifact-preview-mermaid'; source: string };
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

const isMermaidArtifact = (artifact: Artifact) =>
  artifact.type === 'code' &&
  artifact.language?.toLowerCase().trim() === 'mermaid';

/** What the card says of each way the code can fail. */
const PREVIEW_ERROR_TEXT = {
  // It never ran: what is wrong was found before it could.
  build: {
    title: "Couldn't build the code",
    detail: 'The code has an error that stops it from running.'
  },
  // It ran, and threw.
  run: {
    title: 'Error running the code',
    detail: 'The code ran into an error while running.'
  }
} as const;

/**
 * Why a preview failed, floated over it: a build that did not compile, or a
 * page that threw. It can be put away — a page that threw may still show
 * most of itself — and the same error stays away until it is a new one.
 *
 * Where a message can be sent, it offers to have the error fixed. Once per
 * error: a double press would send it twice before the turn has begun and
 * the panel has taken the offer away.
 */
function PreviewErrorCard({
  error,
  kind,
  onFix
}: {
  error: string;
  kind: keyof typeof PREVIEW_ERROR_TEXT;
  onFix?: (error: string) => void;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [sentFor, setSentFor] = useState<string | null>(null);

  if (dismissed === error) return null;

  return (
    <div
      role="alert"
      className="absolute bottom-4 left-4 z-20 w-[min(28rem,calc(100%-2rem))] rounded-xl border bg-background p-5 shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {PREVIEW_ERROR_TEXT[kind].title}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {PREVIEW_ERROR_TEXT[kind].detail}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-2 size-7 shrink-0 text-muted-foreground"
          onClick={() => setDismissed(error)}
        >
          <X className="size-4" />
          <span className="sr-only">Dismiss</span>
        </Button>
      </div>
      <pre
        className={cn(
          'mt-3 max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs',
          // A compile error runs to several lines, a caret under each column
          // it names, and wrapping would move the carets; a thrown message is
          // one line, and wraps.
          error.includes('\n')
            ? 'whitespace-pre'
            : 'wrap-break-word whitespace-pre-wrap'
        )}
      >
        {error}
      </pre>
      {onFix && (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={sentFor === error}
            onClick={() => {
              setSentFor(error);
              onFix(error);
            }}
          >
            <Wrench className="size-3.5" />
            Try fixing
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The error a preview frame reported failing with. Only from `frameRef`'s
 * own window: any frame can post a message to this page.
 */
function usePreviewFailure(
  frameRef: React.RefObject<HTMLIFrameElement | null>
) {
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (
      event: MessageEvent<{ type?: string; message?: string }>
    ) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === 'artifact-preview-error' && event.data.message) {
        setFailure(event.data.message);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [frameRef]);

  return {
    failure,
    clearFailure: useCallback(() => setFailure(null), [])
  };
}

/**
 * `window.fs.readFile` for the artifact in `frameRef`: the frame asks for a
 * file by name, and gets its bytes back, or why not. The frame cannot fetch
 * anything itself that is worth having — it runs at an opaque origin — and
 * may only have the files this page says it can read: the ones attached in
 * its chat.
 */
function useFileReads(frameRef: React.RefObject<HTMLIFrameElement | null>) {
  const files = useContext(ArtifactFilesContext);

  useEffect(() => {
    const handleMessage = async (
      event: MessageEvent<{ type?: string; id?: number; name?: string }>
    ) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || event.source !== frame) return;
      if (event.data?.type !== 'artifact-fs-read') return;
      const { id, name } = event.data;
      const reply = (
        result: { data: ArrayBuffer } | { error: string },
        transfer: Transferable[] = []
      ) =>
        frame.postMessage(
          { type: 'artifact-fs-result', id, ...result },
          '*',
          transfer
        );

      const file = files.find(candidate => candidate.name === name);
      if (!file) {
        reply({
          error: `No file named "${name}". The files that can be read are: ${
            files.map(candidate => candidate.name).join(', ') || 'none'
          }.`
        });
        return;
      }
      try {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.arrayBuffer();
        reply({ data }, [data]);
      } catch {
        reply({ error: `"${name}" could not be read.` });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [frameRef, files]);
}

/**
 * A preview drawn in the sandboxed frame: a React artifact, compiled on the
 * server first, or a Mermaid diagram, which the frame draws from its source.
 */
function FrameArtifactPreview({
  artifact,
  onFix
}: {
  artifact: Artifact;
  onFix?: (error: string) => void;
}) {
  // Use the live content directly (not deferred): the preview is never shown
  // while streaming, so changes are discrete (artifact switches, entering
  // preview). Deferring would let the entry path and the file contents come
  // from different content versions, producing a mismatched/failed compile.
  const content = artifact.content ?? '';
  // On a share page there is no session, and the link stands in for one: the
  // request names it and the artifact, and the server checks that the link
  // opens that artifact — its chat's link, or the artifact's own, opened on
  // its page or embedded in someone's. The link's id is in the address.
  const chatShareId = useMatch({
    from: '/share/$id',
    shouldThrow: false,
    select: match => match.params.id
  });
  const artifactShareId = useMatch({
    from: '/artifact/$id',
    shouldThrow: false,
    select: match => match.params.id
  });
  const embedShareId = useMatch({
    from: '/embed/$id',
    shouldThrow: false,
    select: match => match.params.id
  });
  const shareId = chatShareId ?? artifactShareId ?? embedShareId;
  const isMermaid = isMermaidArtifact(artifact);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<FramePayload | null>(null);
  const iframeTitle = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Frame handshake state lives in refs so the once-bound message listener and
  // the post helper always see the latest values (no stale closures, no race
  // between the iframe load event and the frame's "ready" message).
  const frameReadyRef = useRef(false);
  const payloadRef = useRef<FramePayload | null>(null);
  const fallbackRef = useRef<number | null>(null);
  const { failure, clearFailure } = usePreviewFailure(iframeRef);
  useFileReads(iframeRef);

  // The single place that pushes the latest compiled result into the frame.
  // Called both when a new result compiles AND when the frame (re)announces it
  // is ready — so no ordering can leave the frame without content.
  const postToFrame = useCallback(() => {
    const latest = payloadRef.current;
    if (!frameReadyRef.current || !latest) return;
    clearFailure();
    iframeRef.current?.contentWindow?.postMessage(latest, '*');
    if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
    // If the frame never reports back that it rendered, don't leave the loading
    // overlay stuck forever.
    fallbackRef.current = window.setTimeout(() => setStatus('ready'), 6000);
  }, [clearFailure]);
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
    // A diagram needs no build: its source goes to the frame as it is.
    if (isMermaid) {
      const source = content.trim();
      setStatus(source ? 'loading' : 'idle');
      setError(null);
      setPayload(source ? { type: 'artifact-preview-mermaid', source } : null);
      return;
    }

    if (!requestBody) {
      setStatus('idle');
      setError(null);
      setPayload(null);
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
        setPayload({ type: 'artifact-preview-render', ...cachedResult });
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
        setPayload(null);
        return;
      }

      const compiled = {
        entryPath: result.entryPath,
        files: result.files,
        imports: result.imports ?? []
      };
      previewCacheSet(requestBody, compiled);

      setError(null);
      setPayload({ type: 'artifact-preview-render', ...compiled });
    };

    // Short debounce just to coalesce the few dep changes that fire together.
    const timeoutId = window.setTimeout(() => {
      // A build this preview no longer wants is aborted, and that is not a
      // failure.
      void run().catch(error => {
        if (!cancelled) throw error;
      });
    }, 80);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [requestBody, isMermaid, content]);

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

  // When there is something new to show, stash it and push it to the frame (a
  // no-op until the frame has announced ready, after which the ready handler
  // pushes it).
  useEffect(() => {
    payloadRef.current = payload;
    postToFrame();
  }, [payload, postToFrame]);

  // A build that failed, or a page that threw once built; neither while a new
  // build is on its way.
  const shownError =
    status === 'loading' ? null : status === 'error' ? error : failure;

  // Keep the iframe mounted once we have a compiled result so re-compiles (e.g.
  // switching artifacts) update it in place via postMessage instead of tearing
  // down and reloading the frame (which is slow and shows stale content).
  const hasPreview = Boolean(payload);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {hasPreview ? (
        <>
          <iframe
            ref={iframeRef}
            title={`artifact-frame-preview-${iframeTitle}`}
            sandbox="allow-scripts"
            className="min-h-0 w-full flex-1 bg-white"
            src="/artifact-preview-frame"
          />
        </>
      ) : (
        status === 'loading' && (
          <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            Building preview...
          </div>
        )
      )}
      {hasPreview && status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          Building preview...
        </div>
      )}
      {shownError && (
        <PreviewErrorCard
          error={shownError}
          // A diagram that fails has failed to parse: it never drew.
          kind={status === 'error' || isMermaid ? 'build' : 'run'}
          onFix={onFix}
        />
      )}
    </div>
  );
}

export function supportsArtifactRuntimePreview(artifact: Artifact) {
  if (isHtmlPreviewArtifact(artifact)) return true;
  if (artifact.type === 'markdown') return true;
  if (artifact.type === 'json') return true;
  if (artifact.type === 'code' && isPreviewableCodeLanguage(artifact)) {
    return true;
  }
  return isMermaidArtifact(artifact);
}

// Runs ahead of the artifact's own scripts and reports an error nothing
// caught, in the message the React frame sends — so an HTML artifact shows
// its errors, and offers their fix, as a React one does.
// It says what was thrown as describeThrown does: type and message, the
// type left out when it is a plain Error, and no "Uncaught ".
const HTML_ERROR_REPORTER = `<script>window.addEventListener('error', function (event) {
  var thrown = event.error;
  var message = thrown && thrown.message
    ? (thrown.name && thrown.name !== 'Error' ? thrown.name + ': ' : '') + thrown.message
    : String(event.message || 'Script error').replace(/^Uncaught\\s+/, '');
  try { parent.postMessage({ type: 'artifact-preview-error', message: message }, '*'); } catch (e) {}
});</script>`;

// `window.fs.readFile` in an HTML artifact, as the React frame has it (see
// preview-frame-client): the file is asked of this page by name, and comes
// back as bytes, or as text when an encoding is given.
const HTML_FILE_SYSTEM = `<script>(function () {
  var next = 0, pending = {};
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== parent || !data || data.type !== 'artifact-fs-result') return;
    var request = pending[data.id];
    if (!request) return;
    delete pending[data.id];
    if (data.error) request.reject(new Error(data.error));
    else {
      var bytes = new Uint8Array(data.data);
      request.resolve(request.encoding ? new TextDecoder(request.encoding).decode(bytes) : bytes);
    }
  });
  window.fs = {
    readFile: function (name, options) {
      return new Promise(function (resolve, reject) {
        var id = ++next;
        pending[id] = { resolve: resolve, reject: reject, encoding: options && options.encoding };
        parent.postMessage({ type: 'artifact-fs-read', id: id, name: String(name) }, '*');
      });
    }
  };
})();</script>`;

function HtmlArtifactPreview({
  content,
  onFix
}: {
  content: string;
  onFix?: (error: string) => void;
}) {
  const iframeTitle = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { failure, clearFailure } = usePreviewFailure(iframeRef);
  useFileReads(iframeRef);
  const htmlSource = useMemo(() => {
    // Inject a strict CSP so self-contained HTML/SVG previews can use inline
    // script/style, and a library's script, stylesheet or font from the one
    // CDN, but cannot otherwise reach the network: no fetch, no other host
    // (no exfiltration beyond what a request for a library's file could
    // carry). The meta must sit inside <head> to be honored — placing it
    // before <!DOCTYPE>/<html> would force quirks mode and be ignored.
    const csp =
      `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${HTML_PREVIEW_CDN}; ` +
      `style-src 'unsafe-inline' ${HTML_PREVIEW_CDN}; img-src data: blob:; ` +
      `font-src data: ${HTML_PREVIEW_CDN}; connect-src 'none'`;
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

    // The policy goes in a head of our own, ahead of everything the artifact
    // wrote. Finding the artifact's <head> to put it in means reading HTML
    // with a pattern, and the first `<head>` in the text need not be a tag —
    // inside a comment it takes the policy with it, and the page runs with
    // none. A parser that meets a second <html>, <head> or <body> keeps their
    // contents and folds their attributes into the ones it has, so the
    // document renders as written, under a policy it had no part in placing.
    return `<!DOCTYPE html><html><head>${meta}${HTML_ERROR_REPORTER}${HTML_FILE_SYSTEM}</head><body>${content}</body></html>`;
  }, [content]);

  // New source is a new page: what the last one threw no longer applies.
  useEffect(() => {
    clearFailure();
  }, [htmlSource, clearFailure]);

  return (
    <div className="relative size-full min-h-0">
      <iframe
        ref={iframeRef}
        title={`artifact-preview-${iframeTitle}`}
        sandbox="allow-scripts"
        className="size-full min-h-0 bg-white"
        srcDoc={htmlSource}
      />
      {failure && <PreviewErrorCard error={failure} kind="run" onFix={onFix} />}
    </div>
  );
}

export function ArtifactRuntimePreview({
  artifact,
  onFix
}: {
  artifact: Artifact;
  /** Absent where nobody can send a message: a share page. */
  onFix?: (error: string) => void;
}) {
  if (artifact.type === 'markdown') {
    return (
      <div className="h-full overflow-auto border bg-background p-4">
        <MessageMarkdown content={artifact.content ?? ''} />
      </div>
    );
  }

  if (artifact.type === 'json') {
    return (
      <div className="h-full overflow-auto border bg-background">
        {artifactRegistry.sheet.renderContent(artifact)}
      </div>
    );
  }

  if (isHtmlPreviewArtifact(artifact)) {
    return (
      <HtmlArtifactPreview content={artifact.content ?? ''} onFix={onFix} />
    );
  }

  if (
    artifact.type === 'code' &&
    (isPreviewableCodeLanguage(artifact) || isMermaidArtifact(artifact))
  ) {
    return <FrameArtifactPreview artifact={artifact} onFix={onFix} />;
  }

  return (
    <div className="border border-dashed p-6 text-sm text-muted-foreground">
      Preview is not available for this artifact.
    </div>
  );
}
