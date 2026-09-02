import { useEffect, useMemo, useRef } from 'react';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, lineNumbers } from '@codemirror/view';
import { githubLight } from '@uiw/codemirror-theme-github';
import { useTheme } from 'next-themes';

import { normalizeCodeLanguage } from '@/lib/code-language';

const getLanguageExtension = (language: string) => {
  const normalized = normalizeCodeLanguage(language);

  if (!normalized) return null;

  if (normalized === 'json') return json();
  if (normalized === 'html') return html();
  if (normalized === 'css' || normalized === 'properties') {
    return normalized === 'properties'
      ? StreamLanguage.define(properties)
      : css();
  }
  if (normalized === 'xml' || normalized === 'svg') return xml();
  if (normalized === 'yaml') return yaml();
  if (normalized === 'toml') return StreamLanguage.define(toml);
  if (normalized === 'python') return python();
  if (normalized === 'php') return php();
  if (normalized === 'java') return java();
  if (normalized === 'go') return go();
  if (normalized === 'rust') return rust();
  if (normalized === 'sql') return sql();
  if (normalized === 'c' || normalized === 'cpp') {
    return cpp();
  }
  if (normalized === 'csharp') {
    return StreamLanguage.define(csharp);
  }
  if (normalized === 'dockerfile') {
    return StreamLanguage.define(dockerFile);
  }
  if (normalized === 'nginx') {
    return StreamLanguage.define(nginx);
  }
  if (normalized === 'ini') {
    return StreamLanguage.define(properties);
  }
  if (normalized === 'bash' || normalized === 'zsh') {
    return StreamLanguage.define(shell);
  }
  if (normalized === 'markdown') return markdown();
  if (normalized === 'tsx') return javascript({ jsx: true, typescript: true });
  if (normalized === 'typescript') {
    return javascript({ typescript: true });
  }
  if (normalized === 'jsx') return javascript({ jsx: true });
  if (normalized === 'javascript') return javascript();

  return null;
};

interface CodeEditorProps {
  language: string;
  value: string;
  wrapLongLines?: boolean;
  autoScrollToBottom?: boolean;
  showLineNumbers?: boolean;
}

// Read-only code surface (syntax highlighting + streaming-friendly updates).
export function CodeEditor({
  language,
  value,
  wrapLongLines = false,
  autoScrollToBottom = false,
  showLineNumbers = true
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const { theme = 'system', systemTheme } = useTheme();

  const resolvedTheme = theme === 'system' ? (systemTheme ?? 'light') : theme;

  const extensions = useMemo(() => {
    const languageExtension = getLanguageExtension(language);

    return [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(showLineNumbers ? [lineNumbers()] : []),
      ...(wrapLongLines ? [EditorView.lineWrapping] : []),
      ...(resolvedTheme === 'dark' ? [oneDark] : [githubLight]),
      ...(languageExtension ? [languageExtension] : [])
    ];
  }, [language, resolvedTheme, showLineNumbers, wrapLongLines]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions
      }),
      parent: container
    });

    editorRef.current = view;

    return () => {
      editorRef.current = null;
      view.destroy();
    };
  }, [extensions]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    // Replace only the changed region instead of the whole document. Streaming
    // appends to the end, so this dispatches a tiny insert and CodeMirror
    // re-parses/highlights incrementally — replacing the full doc each delta
    // re-highlights everything and janks badly as the content grows.
    let start = 0;
    const minLength = Math.min(current.length, value.length);
    while (start < minLength && current[start] === value[start]) {
      start += 1;
    }
    let endCurrent = current.length;
    let endValue = value.length;
    while (
      endCurrent > start &&
      endValue > start &&
      current[endCurrent - 1] === value[endValue - 1]
    ) {
      endCurrent -= 1;
      endValue -= 1;
    }

    view.dispatch({
      changes: {
        from: start,
        to: endCurrent,
        insert: value.slice(start, endValue)
      }
    });
  }, [value]);

  useEffect(() => {
    if (!autoScrollToBottom) return;

    requestAnimationFrame(() => {
      const scrollDOM = editorRef.current?.scrollDOM;
      if (!scrollDOM) return;
      scrollDOM.scrollTop = scrollDOM.scrollHeight;
    });
  }, [autoScrollToBottom, value]);

  return (
    <div
      ref={containerRef}
      className="min-w-0 [&_.cm-content]:font-mono [&_.cm-content]:text-sm [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-hidden [&_.cm-gutters]:border-0 [&_.cm-gutters]:bg-transparent [&_.cm-scroller]:font-mono"
    />
  );
}
