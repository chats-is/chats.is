import type { ArtifactType } from '@/types';

export type ArtifactKind = 'text' | 'code' | 'image' | 'sheet' | 'file';

/**
 * Languages whose `code` artifacts are eligible for the live React/TS preview.
 * Kept as a single source of truth so the chat tool, the artifact router and
 * the preview compile endpoint all agree on what "previewable" means.
 */
export const PREVIEWABLE_CODE_LANGUAGES = new Set([
  'react',
  'tsx',
  'jsx',
  'typescript',
  'javascript'
]);

/**
 * The bare package specifiers the sandboxed preview can resolve. React plus a
 * curated set of libraries bundled from our own origin (no external CDN), so
 * previews stay fully offline.
 */
export const PREVIEW_ALLOWED_IMPORTS = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'lucide-react',
  'framer-motion',
  'recharts',
  'clsx',
  'class-variance-authority'
]);

/**
 * Matches `import ... from 'x'`, side-effect `import 'x'`, dynamic `import('x')`
 * and `require('x')`.
 */
export const PREVIEW_IMPORT_RE =
  /\bimport\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

/** A relative file path that ends in an extension, e.g. `components/Button.tsx`. */
export const ARTIFACT_FILENAME_RE = /^[A-Za-z0-9._/-]+\.[A-Za-z0-9]+$/;

export const looksLikeJsx = (code: string): boolean =>
  /<\s*[A-Za-z][\w:-]*(\s|\/?>)/.test(code) || /<>\s*/.test(code);

export const isRelativeImport = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../');

export const isStyleImport = (specifier: string): boolean =>
  /\.css($|\?)/.test(specifier) ||
  /\.scss($|\?)/.test(specifier) ||
  /\.sass($|\?)/.test(specifier);

/**
 * Returns the unsupported (non-react, non-relative, non-style) import specifiers
 * found in `code`. An empty array means every import is allowed in the preview.
 */
export const validatePreviewImports = (code: string): string[] => {
  const unsupported: string[] = [];

  for (const match of code.matchAll(PREVIEW_IMPORT_RE)) {
    const specifier = match[1] || match[2] || match[3] || match[4];
    if (
      specifier &&
      !PREVIEW_ALLOWED_IMPORTS.has(specifier) &&
      !isRelativeImport(specifier) &&
      !isStyleImport(specifier)
    ) {
      unsupported.push(specifier);
    }
  }

  return Array.from(new Set(unsupported));
};

/** Maps an artifact `type` to the UI/render kind. */
export const artifactKindFromType = (
  type?: ArtifactType | null
): ArtifactKind => {
  if (type === 'image') return 'image';
  if (type === 'file') return 'file';
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
  content?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
};

/**
 * Validates an artifact payload before it is streamed/persisted. Throws with a
 * human-readable message on the first violation. Shared by the chat tool's
 * `create_artifact` and any server-side artifact creation path.
 */
export const assertArtifactPayload = (input: ArtifactPayloadInput): void => {
  const isFileArtifact = input.type === 'image' || input.type === 'file';

  if (isFileArtifact) {
    if (!input.fileUrl) {
      throw new Error('fileUrl is required for file/image artifacts');
    }
    return;
  }

  if (input.content == null) {
    throw new Error('content is required for non-file artifacts');
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
      `Previewable React/code artifacts only support react imports and relative imports. Unsupported imports: ${unsupportedImports.join(', ')}`
    );
  }

  if (looksLikeJsx(input.content) && !/\.(tsx|jsx)$/i.test(fileName)) {
    throw new Error('Files containing JSX must use a .tsx or .jsx fileName');
  }
};
