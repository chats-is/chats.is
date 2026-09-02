type ArtifactLanguageSource = {
  language?: string | null;
  fileName?: string | null;
  title?: string | null;
  mimeType?: string | null;
  type?: string | null;
};

export type CodeLanguageKey =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'html'
  | 'css'
  | 'xml'
  | 'svg'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'toml'
  | 'python'
  | 'php'
  | 'java'
  | 'go'
  | 'rust'
  | 'sql'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'dockerfile'
  | 'nginx'
  | 'ini'
  | 'properties'
  | 'bash'
  | 'zsh'
  | 'text'
  | 'code';

const LANGUAGE_ALIASES: Record<CodeLanguageKey, string[]> = {
  javascript: ['javascript', 'js', 'mjs', 'cjs'],
  jsx: ['jsx'],
  typescript: ['typescript', 'ts', 'mts', 'cts'],
  // 'react' is an accepted artifact language (see ArtifactSystemPrompt) and
  // means a TSX component file.
  tsx: ['tsx', 'react'],
  html: ['html', 'htm'],
  css: ['css', 'scss', 'sass', 'less'],
  xml: ['xml'],
  svg: ['svg'],
  json: ['json'],
  markdown: ['markdown', 'md', 'mdx'],
  yaml: ['yaml', 'yml'],
  toml: ['toml'],
  python: ['python', 'py'],
  php: ['php'],
  java: ['java'],
  go: ['go', 'golang'],
  rust: ['rust', 'rs'],
  sql: ['sql'],
  c: ['c', 'h'],
  cpp: ['cpp', 'c++', 'cc', 'cxx', 'hpp', 'hh', 'hxx'],
  csharp: ['csharp', 'cs', 'c#'],
  dockerfile: ['dockerfile'],
  nginx: ['nginx'],
  ini: ['ini', 'conf'],
  properties: ['properties'],
  bash: ['bash', 'shell', 'sh', 'env'],
  zsh: ['zsh'],
  text: ['text', 'txt'],
  code: ['code']
};

const PATH_LANGUAGE_MATCHERS: Array<[string[], CodeLanguageKey]> = [
  [['.html', '.htm'], 'html'],
  [['.css', '.scss', '.sass', '.less'], 'css'],
  [['.js', '.mjs', '.cjs'], 'javascript'],
  [['.jsx'], 'jsx'],
  [['.ts', '.mts', '.cts'], 'typescript'],
  [['.tsx'], 'tsx'],
  [['.json'], 'json'],
  [['.md', '.mdx'], 'markdown'],
  [['.xml'], 'xml'],
  [['.svg'], 'svg'],
  [['.yaml', '.yml'], 'yaml'],
  [['.toml'], 'toml'],
  [['.py'], 'python'],
  [['.java'], 'java'],
  [['.go'], 'go'],
  [['.rs'], 'rust'],
  [['.sql'], 'sql'],
  [['.php'], 'php'],
  [['.c', '.h'], 'c'],
  [['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], 'cpp'],
  [['.cs'], 'csharp'],
  [['.ini', '.conf'], 'ini'],
  [['.properties'], 'properties'],
  [['.sh', '.bash', '.env'], 'bash'],
  [['.zsh'], 'zsh']
];

export function normalizeCodeLanguage(
  language?: string | null
): CodeLanguageKey | null {
  if (!language) return null;

  const normalized = language.toLowerCase().trim();

  for (const [key, aliases] of Object.entries(LANGUAGE_ALIASES) as Array<
    [CodeLanguageKey, string[]]
  >) {
    if (aliases.includes(normalized)) {
      return key;
    }
  }

  return null;
}

export function inferCodeLanguageFromPath(
  value?: string | null
): CodeLanguageKey | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  for (const [extensions, language] of PATH_LANGUAGE_MATCHERS) {
    if (extensions.some(extension => normalized.endsWith(extension))) {
      return language;
    }
  }

  if (normalized.endsWith('/dockerfile') || normalized === 'dockerfile') {
    return 'dockerfile';
  }

  if (normalized.endsWith('.nginx') || normalized.endsWith('nginx.conf')) {
    return 'nginx';
  }

  return null;
}

export function inferCodeLanguageFromMimeType(
  mimeType?: string | null
): CodeLanguageKey | null {
  if (!mimeType) return null;

  const normalized = mimeType.toLowerCase();

  if (normalized.includes('text/html')) return 'html';
  if (normalized.includes('text/css')) return 'css';
  if (normalized.includes('application/json')) return 'json';
  if (normalized.includes('text/markdown')) return 'markdown';
  if (normalized.includes('javascript')) return 'javascript';
  if (normalized.includes('typescript')) return 'typescript';
  if (normalized.includes('yaml')) return 'yaml';
  if (normalized.includes('toml')) return 'toml';
  if (normalized.includes('python')) return 'python';
  if (normalized.includes('java')) return 'java';
  if (normalized.includes('php')) return 'php';
  if (normalized.includes('csharp') || normalized.includes('c#'))
    return 'csharp';
  if (normalized.includes('sql')) return 'sql';
  if (normalized.includes('xml')) return 'xml';
  if (normalized.includes('svg')) return 'svg';
  if (normalized.includes('docker')) return 'dockerfile';
  if (normalized.includes('nginx')) return 'nginx';
  if (normalized.includes('x-ini')) return 'ini';
  if (normalized.includes('properties')) return 'properties';
  if (normalized.includes('shellscript') || normalized.includes('x-sh')) {
    return 'bash';
  }

  return null;
}

export function getArtifactLanguageLabel(
  artifact: ArtifactLanguageSource
): string {
  const explicitLanguage = artifact.language?.toLowerCase().trim();
  if (explicitLanguage) return explicitLanguage;

  const inferredLanguage =
    inferCodeLanguageFromPath(artifact.fileName) ??
    inferCodeLanguageFromPath(artifact.title) ??
    inferCodeLanguageFromMimeType(artifact.mimeType);

  if (inferredLanguage) return inferredLanguage;

  return artifact.type?.toLowerCase().trim() || '';
}
