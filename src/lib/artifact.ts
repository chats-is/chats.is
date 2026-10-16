import { type DataUIPart, type TextPart } from 'ai';

import {
  type ArtifactType,
  type CustomUIDataTypes,
  type PreviewPackage
} from '@/types';
import { normalizeCodeLanguage } from '@/lib/code-language';
import { HTML_PREVIEW_CDN, PREVIEW_PACKAGES } from '@/lib/constant';

export type ArtifactKind = 'text' | 'code' | 'sheet';

/**
 * Languages whose `code` artifacts are eligible for the live React/TS preview.
 * Kept as a single source of truth so the chat tool, the artifact router and
 * the preview compile endpoint all agree on what "previewable" means.
 */
const PREVIEWABLE_CODE_LANGUAGES = new Set([
  'react',
  'tsx',
  'jsx',
  'typescript',
  'javascript'
]);

/**
 * The bare package specifiers the sandboxed preview can resolve: React, and
 * the curated packages the frame loads from our own origin as they are
 * needed (no external CDN), so previews stay fully offline.
 */
const PREVIEW_ALLOWED_IMPORTS = new Set<string>([
  'react',
  'react-dom',
  'react-dom/client',
  ...PREVIEW_PACKAGES.map(pkg => pkg.name)
]);

const PREVIEW_PACKAGE_NAMES = new Set<string>(
  PREVIEW_PACKAGES.map(pkg => pkg.name)
);

/**
 * Matches `import ... from 'x'`, side-effect `import 'x'`, dynamic `import('x')`
 * and `require('x')`.
 */
const PREVIEW_IMPORT_RE =
  /\bimport\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

/** A relative file path that ends in an extension, e.g. `components/Button.tsx`. */
const ARTIFACT_FILENAME_RE = /^[A-Za-z0-9._/-]+\.[A-Za-z0-9]+$/;

export const looksLikeJsx = (code: string): boolean =>
  /<\s*[A-Za-z][\w:-]*(\s|\/?>)/.test(code) || /<>\s*/.test(code);

export const isRelativeImport = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../');

export const isStyleImport = (specifier: string): boolean =>
  /\.css($|\?)/.test(specifier) ||
  /\.scss($|\?)/.test(specifier) ||
  /\.sass($|\?)/.test(specifier);

const importSpecifiers = (code: string): string[] =>
  Array.from(
    code.matchAll(PREVIEW_IMPORT_RE),
    match => (match[1] || match[2] || match[3] || match[4]) ?? ''
  ).filter(Boolean);

/**
 * Returns the unsupported (non-react, non-relative, non-style) import specifiers
 * found in `code`. An empty array means every import is allowed in the preview.
 */
export const validatePreviewImports = (code: string): string[] =>
  Array.from(
    new Set(
      importSpecifiers(code).filter(
        specifier =>
          !PREVIEW_ALLOWED_IMPORTS.has(specifier) &&
          !isRelativeImport(specifier) &&
          !isStyleImport(specifier)
      )
    )
  );

/**
 * The curated packages `code` imports, for the frame to load before it runs
 * the code: it loads a package only when a preview asks for it.
 */
export const previewPackageImports = (code: string): PreviewPackage[] =>
  Array.from(
    new Set(
      importSpecifiers(code).filter((specifier): specifier is PreviewPackage =>
        PREVIEW_PACKAGE_NAMES.has(specifier)
      )
    )
  );

/**
 * The scripts and stylesheets an HTML page loads from anywhere but
 * HTML_PREVIEW_CDN — which its preview would block. Addresses on the page's
 * own (opaque, sandboxed) origin load nothing either, so only absolute and
 * protocol-relative ones are counted; a protocol-relative one resolves to
 * http against the app and is blocked too.
 */
const HTML_RESOURCE_RE =
  /<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)|<link\b[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi;

export const blockedHtmlResources = (html: string): string[] =>
  Array.from(
    new Set(
      Array.from(
        html.matchAll(HTML_RESOURCE_RE),
        match => match[1] ?? match[2] ?? ''
      ).filter(
        url =>
          /^(https?:)?\/\//i.test(url) &&
          !url.startsWith(`${HTML_PREVIEW_CDN}/`)
      )
    )
  );

/** Previewed as a page in the HTML frame: HTML itself, or SVG. */
export const isHtmlPreviewArtifact = (input: {
  type: ArtifactType;
  language?: string | null;
}): boolean => {
  if (input.type === 'html') return true;
  const language = normalizeCodeLanguage(input.language);
  return input.type === 'code' && (language === 'html' || language === 'svg');
};

/** Maps an artifact `type` to the UI/render kind. */
export const artifactKindFromType = (
  type?: ArtifactType | null
): ArtifactKind => {
  if (type === 'json') return 'sheet';
  if (type === 'code' || type === 'html') return 'code';
  return 'text';
};

/** Convenience wrapper for callers holding a whole artifact-like object. */
export const getArtifactKind = (artifact: {
  type?: ArtifactType | null;
}): ArtifactKind => artifactKindFromType(artifact.type);

export const isPreviewableCodeArtifact = (input: {
  type: ArtifactType;
  language?: string | null;
}): boolean => {
  if (input.type !== 'code') return false;
  const language = input.language?.toLowerCase().trim();
  return !!language && PREVIEWABLE_CODE_LANGUAGES.has(language);
};

export type ArtifactPayloadInput = {
  type: ArtifactType;
  language?: string | null;
  content: string;
  fileName?: string | null;
};

/**
 * Validates an artifact payload before it is streamed/persisted. Throws with a
 * human-readable message on the first violation. Shared by the chat tool's
 * `create_artifact` and any server-side artifact creation path.
 */
export const assertArtifactPayload = (input: ArtifactPayloadInput): void => {
  if (isHtmlPreviewArtifact(input)) {
    const blocked = blockedHtmlResources(input.content);
    if (blocked.length > 0) {
      throw new Error(
        `HTML artifacts can load scripts and stylesheets only from ${HTML_PREVIEW_CDN}; the preview blocks every other host. Load the library from its ${HTML_PREVIEW_CDN}/ajax/libs/… address, or put the code inline. Blocked: ${blocked.join(', ')}`
      );
    }
    return;
  }

  if (!isPreviewableCodeArtifact(input)) {
    return;
  }

  const fileName = input.fileName?.trim();
  if (!fileName) {
    throw new Error('Previewable React/code artifacts must include fileName');
  }

  if (!ARTIFACT_FILENAME_RE.test(fileName)) {
    throw new Error(
      'Previewable React/code artifact fileName must be a valid relative file path'
    );
  }

  const unsupportedImports = validatePreviewImports(input.content);
  if (unsupportedImports.length > 0) {
    throw new Error(
      `Previewable React/code artifacts can import only React and the packages listed in the instructions. Unsupported imports: ${unsupportedImports.join(', ')}`
    );
  }

  if (looksLikeJsx(input.content) && !/\.(tsx|jsx)$/i.test(fileName)) {
    throw new Error('Files containing JSX must use a .tsx or .jsx fileName');
  }
};

/** What naming and building an artifact's preview needs of it. */
type PreviewArtifact = {
  id: string;
  title: string;
  type: ArtifactType;
  language?: string | null;
  fileName?: string | null;
  content?: string | null;
};

/** One file of a preview: a virtual path and the source behind it. */
export type PreviewFile = {
  path: string;
  code: string;
  language?: string;
};

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')
    .replace(/[^A-Za-z0-9._/-]/g, '-');

const getArtifactFileExtension = (artifact: PreviewArtifact) => {
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
};

const hasPathExtension = (value: string) => {
  const lastSegment = value.split('/').pop() ?? value;
  return /\.[A-Za-z0-9]+$/.test(lastSegment);
};

const extractLeadingFileName = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^([A-Za-z0-9_-][A-Za-z0-9._/-]*\.(?:tsx|ts|jsx|js|css|html|json|md))(?=$|\s|[-:])/
  );
  return match?.[1] ?? null;
};

const extractDefaultExportName = (code: string) => {
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
};

/**
 * The path a preview is entered at. Here rather than beside the preview, so
 * the server compiling a new artifact builds exactly what the browser will.
 */
export const getArtifactVirtualPath = (artifact: PreviewArtifact) => {
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
};

const getArtifactVirtualPaths = (artifact: PreviewArtifact) => {
  const extension = getArtifactFileExtension(artifact);
  const paths = new Set<string>([getArtifactVirtualPath(artifact)]);
  const exportName = extractDefaultExportName(artifact.content ?? '');

  if (exportName) {
    paths.add(`/${exportName}.${extension}`);
  }

  return Array.from(paths);
};

// Each artifact is an independent, self-contained file, so the preview is built
// from ONLY the selected artifact. (Merging every code artifact in the chat
// collided their identical entry paths — e.g. multiple `index.tsx` — and made
// switching show the wrong one.)
export const buildPreviewFiles = (artifact: PreviewArtifact): PreviewFile[] => {
  if (artifact.type !== 'code' || !artifact.content) {
    return [];
  }

  return getArtifactVirtualPaths(artifact).map(path => ({
    path,
    code: artifact.content ?? '',
    language: artifact.language ?? undefined
  }));
};

/**
 * What the model is given for a data part of a message. The artifact a
 * reader's message is about becomes the instruction the reader never saw:
 * to fix its code's error, sent from Try fixing, or to act on a passage they
 * selected in it. Every other data part is the page's, not the model's, and
 * is left out.
 *
 * The error is the code's, not the preview's, which only shows it. And
 * the reader knows no artifact, id or tool, so the reply must not name
 * them, or it says what the instruction said.
 */
export const dataPartForModel = (
  part: DataUIPart<CustomUIDataTypes>
): TextPart | undefined => {
  if (part.type !== 'data-artifactRef') return undefined;
  const { id, selection } = part.data;
  return {
    type: 'text',
    text:
      selection === undefined
        ? `The text above is an error that the code of the artifact with id ${id} raised. Call update_artifact on that artifact now to fix the code: only the call changes it, and saying it is fixed does not. Then tell the user what was wrong and what you changed, in the language the user writes in — the error text is the program's, not theirs — calling it by its title or by what it is (the page, the chart, the component), and not mentioning artifacts, ids or tool names to them.`
        : `The user selected this passage in the artifact with id ${id}, and the message that follows is about it:\n\n<selection>\n${selection}\n</selection>\n\nIf they ask for a change, call update_artifact on that artifact to make it, changing this passage and only what else the request needs: take oldStr from the passage, with the lines around it when the passage appears in the artifact more than once. Only the call changes it, and saying it is changed does not. If they ask a question, answer it and change nothing. Answer in the language the user writes in, calling the artifact by its title or by what it is (the page, the chart, the component), and not mentioning artifacts, ids or tool names to them.`
  };
};

/**
 * What a preview says was thrown: its type and message, as JavaScript
 * writes them — `ReferenceError: x is not defined` — since the type tells
 * the reader, and the model, what kind of mistake it is. A plain `Error`
 * adds nothing, so its message stands alone. A browser's "Uncaught " is
 * dropped from a message that carries one.
 */
export const describeThrown = (thrown: unknown, fallback: string): string => {
  if (thrown instanceof Error) {
    const message = thrown.message || fallback;
    return thrown.name && thrown.name !== 'Error'
      ? `${thrown.name}: ${message}`
      : message;
  }
  if (typeof thrown === 'string' && thrown) {
    return thrown.replace(/^Uncaught\s+/, '');
  }
  return fallback;
};
