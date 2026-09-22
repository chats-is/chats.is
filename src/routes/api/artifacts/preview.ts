import { createHash } from 'node:crypto';
import { createFileRoute } from '@tanstack/react-router';
import ts from 'typescript';
import { z } from 'zod';

import { type User } from '@/types';
import { looksLikeJsx, validatePreviewImports } from '@/lib/artifact';
import { UNAUTHORIZED } from '@/lib/auth-error';
import { normalizeCodeLanguage } from '@/lib/code-language';
import { optionalAuthRequest } from '@/server/middleware';
import { getSharedArtifact } from '@/server/services/share';

/**
 * Open to two callers: a signed-in user, previewing anything; and a reader of
 * a share link, previewing an artifact of the chat it opens. The second is
 * checked below rather than by a tier, because what it needs is not a session
 * but the link — see `getSharedArtifact`.
 */
export const Route = createFileRoute('/api/artifacts/preview')({
  server: {
    middleware: [optionalAuthRequest],
    handlers: { POST }
  }
});

/** The most source one preview may carry, across all its files. */
const MAX_TOTAL_CODE = 1_000_000;

const requestSchema = z.object({
  entryPath: z.string().min(1).max(500),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        code: z.string().max(200_000),
        language: z.string().optional()
      })
    )
    .min(1)
    .max(50)
    // Each file has a ceiling and so does their number, which still multiply
    // out to ten megabytes — all of it compiled in one go, on the thread
    // that serves everyone else. An artifact is a component and a few
    // helpers; a whole one is a small fraction of this.
    .refine(
      files =>
        files.reduce((total, file) => total + file.code.length, 0) <=
        MAX_TOTAL_CODE,
      { message: 'Preview is too large' }
    ),
  /** Sent instead of a session by a share page: which link, which artifact. */
  share: z
    .object({ id: z.string().min(1), artifactId: z.string().min(1) })
    .optional()
});

type PreviewInput = z.infer<typeof requestSchema>;
type PreviewResult = { status: number; body: Record<string, unknown> };

// Same canonicalization the client uses (react→tsx etc. via the shared alias
// table) so both sides agree on what compiles; unknown languages pass through
// (they're skipped below) and a missing language defaults to tsx.
const normalizePreviewLanguage = (language?: string) =>
  normalizeCodeLanguage(language) ??
  (language ? language.toLowerCase().trim() : 'tsx');

// --- Compile cache (per server instance) -----------------------------------
// Identical input always produces identical output, so memoize by a hash of the
// request. Bounded LRU: re-inserting on hit keeps hot entries, oldest evicted.
//
// Bounded by what it holds as well as by how many: entries run from a few
// kilobytes to a few megabytes, so a count alone lets a few hundred large ones
// keep gigabytes alive for the life of the process.
const CACHE_MAX = 256;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const compileCache = new Map<string, PreviewResult>();
const entryBytes = new Map<string, number>();
let cacheBytes = 0;

const evict = (key: string) => {
  compileCache.delete(key);
  cacheBytes -= entryBytes.get(key) ?? 0;
  entryBytes.delete(key);
};

const cacheKey = (input: PreviewInput) => {
  const canonical = {
    entryPath: input.entryPath,
    files: [...input.files]
      .map(file => ({
        path: file.path,
        code: file.code,
        language: file.language ?? ''
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const cacheGet = (key: string) => {
  const hit = compileCache.get(key);
  if (hit) {
    compileCache.delete(key);
    compileCache.set(key, hit);
  }
  return hit;
};

const cacheSet = (key: string, result: PreviewResult) => {
  const bytes = JSON.stringify(result.body).length;
  // One that would take a large share of the cache by itself is not worth
  // evicting many others for; compiling it again is the cheaper loss.
  if (bytes > CACHE_MAX_BYTES / 8) return;

  compileCache.set(key, result);
  entryBytes.set(key, bytes);
  cacheBytes += bytes;

  while (compileCache.size > CACHE_MAX || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = compileCache.keys().next().value;
    if (oldest === undefined) break;
    evict(oldest);
  }
};

// --- Rate limit (per caller, per server instance) --------------------------
// Compilation is CPU-bound; cap how often a single caller can trigger it. A
// caller is a user, or — for the readers of a share link, who have no identity
// here — the link itself.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10_000;
const rateBuckets = new Map<string, number[]>();
let rateCalls = 0;

const isRateLimited = (caller: string) => {
  const now = Date.now();

  // Periodically evict buckets whose timestamps have all expired so inactive
  // users don't accumulate in the map forever.
  if (++rateCalls % 500 === 0) {
    for (const [id, times] of rateBuckets) {
      if (times.every(time => now - time >= RATE_WINDOW_MS)) {
        rateBuckets.delete(id);
      }
    }
  }

  const recent = (rateBuckets.get(caller) ?? []).filter(
    time => now - time < RATE_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT) {
    rateBuckets.set(caller, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(caller, recent);
  return false;
};

/**
 * Whether a request made on a share link, with no session, may be compiled:
 * the artifact it names is in the shared chat, and what it asks to compile is
 * that artifact's source and nothing else. Every file of a preview carries
 * the artifact's whole content — the paths are virtual — so each is held to
 * it. Without this, a share link would make the compiler public.
 */
const isSharedSource = async (input: PreviewInput): Promise<boolean> => {
  if (!input.share) return false;

  const artifact = await getSharedArtifact(
    input.share.id,
    input.share.artifactId
  );
  if (!artifact?.content) return false;

  return input.files.every(file => file.code === artifact.content);
};

const compilePreview = (input: PreviewInput): PreviewResult => {
  const { entryPath, files } = input;

  try {
    const compiledFiles: Record<string, string> = {};
    const errors: string[] = [];
    let hasEntry = false;

    for (const file of files) {
      if (file.path === entryPath) {
        hasEntry = true;
      }

      const requestedLanguage = normalizePreviewLanguage(file.language);
      const normalizedLanguage =
        requestedLanguage === 'typescript' && looksLikeJsx(file.code)
          ? 'tsx'
          : requestedLanguage === 'javascript' && looksLikeJsx(file.code)
            ? 'jsx'
            : requestedLanguage;

      if (
        !['tsx', 'jsx', 'typescript', 'javascript'].includes(normalizedLanguage)
      ) {
        continue;
      }

      const unsupportedImports = validatePreviewImports(file.code);
      if (unsupportedImports.length > 0) {
        errors.push(
          `${file.path}: Only react imports are supported. Unsupported imports: ${unsupportedImports.join(', ')}`
        );
        continue;
      }

      const output = ts.transpileModule(file.code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.React,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true
        },
        reportDiagnostics: true,
        fileName: file.path
      });

      const fileErrors =
        output.diagnostics
          ?.filter(
            diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
          )
          .map(diagnostic => {
            const message = ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              '\n'
            );
            return `${file.path}: ${message}`;
          }) ?? [];

      if (fileErrors.length > 0) {
        errors.push(...fileErrors);
        continue;
      }

      compiledFiles[file.path] = output.outputText;
    }

    if (!hasEntry) {
      return {
        status: 400,
        body: { error: `Entry file not found: ${entryPath}` }
      };
    }

    if (errors.length > 0) {
      return { status: 400, body: { error: errors.join('\n\n') } };
    }

    if (!compiledFiles[entryPath]) {
      return {
        status: 400,
        body: { error: `Preview does not support ${entryPath}` }
      };
    }

    return { status: 200, body: { entryPath, files: compiledFiles } };
  } catch {
    return { status: 500, body: { error: 'Failed to compile preview' } };
  }
};

async function POST({
  request: req,
  context
}: {
  request: Request;
  context: { user: User | null };
}) {
  const { user } = context;

  const json = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json({ error: 'Invalid preview payload' }, { status: 400 });
  }

  if (!user && !parsed.data.share) {
    return Response.json({ error: UNAUTHORIZED }, { status: 401 });
  }

  // The limit is applied before the share is looked up, on the link the
  // request claims: proving the claim costs two reads, and a request that
  // proves nothing would otherwise cost them without limit.
  const caller = user ? user.id : `share:${parsed.data.share!.id}`;
  if (isRateLimited(caller)) {
    return Response.json(
      { error: 'Too many preview requests. Please slow down.' },
      { status: 429 }
    );
  }

  if (!user && !(await isSharedSource(parsed.data))) {
    return Response.json({ error: UNAUTHORIZED }, { status: 401 });
  }

  const key = cacheKey(parsed.data);
  const cached = cacheGet(key);
  const result = cached ?? compilePreview(parsed.data);
  if (!cached) {
    cacheSet(key, result);
  }

  return Response.json(result.body, { status: result.status });
}
