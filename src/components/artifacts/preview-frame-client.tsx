import React, { useEffect, useState } from 'react';

import { type PreviewPackage } from '@/types';

// The curated packages, each loaded from our own origin the first time a
// preview imports it (no CDN, so previews stay fully offline), and handed to
// the sandbox's require(). One for every entry of PREVIEW_PACKAGES — the
// `satisfies` refuses to build with one missing or one too many.
const PREVIEW_PACKAGE_LOADERS = {
  'lucide-react': () => import('lucide-react'),
  recharts: () => import('recharts'),
  'framer-motion': () => import('framer-motion'),
  clsx: () => import('clsx'),
  'class-variance-authority': () => import('class-variance-authority'),
  lodash: () => import('lodash'),
  d3: () => import('d3'),
  'chart.js/auto': () => import('chart.js/auto'),
  'plotly.js-dist-min': () => import('plotly.js-dist-min'),
  three: () => import('three'),
  mathjs: () => import('mathjs'),
  papaparse: () => import('papaparse'),
  xlsx: () => import('xlsx'),
  '@/components/ui/avatar': () => import('@/components/ui/avatar'),
  '@/components/ui/badge': () => import('@/components/ui/badge'),
  '@/components/ui/button': () => import('@/components/ui/button'),
  '@/components/ui/card': () => import('@/components/ui/card'),
  '@/components/ui/checkbox': () => import('@/components/ui/checkbox'),
  '@/components/ui/dialog': () => import('@/components/ui/dialog'),
  '@/components/ui/input': () => import('@/components/ui/input'),
  '@/components/ui/label': () => import('@/components/ui/label'),
  '@/components/ui/progress': () => import('@/components/ui/progress'),
  '@/components/ui/select': () => import('@/components/ui/select'),
  '@/components/ui/separator': () => import('@/components/ui/separator'),
  '@/components/ui/skeleton': () => import('@/components/ui/skeleton'),
  '@/components/ui/switch': () => import('@/components/ui/switch'),
  '@/components/ui/table': () => import('@/components/ui/table'),
  '@/components/ui/tabs': () => import('@/components/ui/tabs'),
  '@/components/ui/textarea': () => import('@/components/ui/textarea')
} satisfies Record<PreviewPackage, () => Promise<object>>;

// What the compiled CommonJS gets for a package. `__esModule: true` makes its
// interop helpers take the module as it is rather than wrap it again. A
// CommonJS package (lodash, Papa Parse, Plotly) arrives as its exports under
// `default`, so those are spread in too, for a named import to find.
const wrapModule = (mod: object) => {
  const namespace = mod as Record<string, unknown>;
  const exports = namespace.default;
  return {
    ...(exports &&
    (typeof exports === 'object' || typeof exports === 'function')
      ? exports
      : {}),
    ...namespace,
    __esModule: true,
    default: exports ?? namespace
  };
};

const loadedPackages = new Map<PreviewPackage, unknown>();

const loadPackage = async (name: PreviewPackage) => {
  if (!loadedPackages.has(name)) {
    loadedPackages.set(name, wrapModule(await PREVIEW_PACKAGE_LOADERS[name]()));
  }
};

type RenderState =
  | {
      status: 'idle';
    }
  | {
      status: 'error';
      message: string;
    }
  | {
      status: 'element';
      element: React.ReactElement;
    }
  | {
      status: 'component';
      component: React.ComponentType;
    }
  | {
      status: 'markup';
      html: string;
    };

/**
 * Storage the artifact can use, since the real one is out of reach.
 *
 * The frame runs at an opaque origin — that is what makes running the
 * model's code safe — and an opaque origin has no `localStorage` or
 * `sessionStorage`: reading either throws. Artifacts reach for them all the
 * time, to remember a theme or a score, and one that does should run rather
 * than crash. So each is replaced with a store that lives in memory. It lasts
 * as long as the frame: a preview does not persist across reloads, and it
 * must not, since anything it kept would be kept per origin, and every
 * artifact here shares the one opaque origin.
 */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: index => [...store.keys()][index] ?? null,
    getItem: key => store.get(String(key)) ?? null,
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: key => {
      store.delete(String(key));
    },
    clear: () => store.clear()
  };
  return storage;
}

function installMemoryStorage() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      // Reachable, so leave it: the frame is not sandboxed, and the guard
      // below will refuse to run anything anyway.
      void window[name];
    } catch {
      Object.defineProperty(window, name, {
        value: memoryStorage(),
        configurable: true,
        writable: true
      });
    }
  }
}

type PreviewMessage =
  | {
      type: 'artifact-preview-render';
      entryPath: string;
      files: Record<string, string>;
      imports?: PreviewPackage[];
    }
  | { type: 'artifact-preview-mermaid'; source: string };

// Catches errors thrown while rendering the previewed component so a runtime
// crash surfaces as a readable message instead of a blank frame. Resets itself
// whenever `resetKey` changes (i.e. a new preview is rendered).
class PreviewErrorBoundary extends React.Component<
  {
    resetKey: number;
    onError: (message: string) => void;
    children: React.ReactNode;
  },
  { hasError: boolean; resetKey: number }
> {
  constructor(props: {
    resetKey: number;
    onError: (message: string) => void;
    children: React.ReactNode;
  }) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey: number },
    state: { hasError: boolean; resetKey: number }
  ) {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: unknown) {
    this.props.onError(
      error instanceof Error ? error.message : 'Preview crashed while rendering'
    );
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

const normalizePath = (value: string) => {
  const parts: string[] = [];

  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `/${parts.join('/')}`;
};

const getDirectoryName = (value: string) => {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
};

const resolveImportPath = (
  specifier: string,
  fromPath: string,
  files: Record<string, string>
) => {
  if (specifier.endsWith('.css')) {
    return normalizePath(`${getDirectoryName(fromPath)}/${specifier}`);
  }

  const basePath = normalizePath(`${getDirectoryName(fromPath)}/${specifier}`);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`
  ];

  return candidates.find(candidate => files[candidate]) ?? null;
};

export function ArtifactPreviewFrameClient() {
  const [state, setState] = useState<RenderState>({ status: 'idle' });
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);

  // Load the bundled Tailwind v4 browser runtime (served from our own origin,
  // no external CDN) so utility classes in previewed components are styled.
  // Imported lazily on the client because it touches `window`/`document`.
  //
  // Its preflight comes after the app's stylesheet and puts every border back
  // to the text colour, so a shadcn/ui card is drawn in black. Given to the
  // runtime itself, the app's border colour follows its preflight again.
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('type', 'text/tailwindcss');
    style.textContent =
      '@layer base { *, ::after, ::before, ::backdrop { border-color: var(--border); } }';
    document.head.appendChild(style);
    void import('@tailwindcss/browser');
  }, []);

  // An error nothing caught — thrown from a handler or a timer once the
  // component is up. The ErrorBoundary only sees what is thrown while
  // rendering.
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setRuntimeError(event.message || 'Runtime error in preview');
    };
    window.addEventListener('error', onError);
    return () => window.removeEventListener('error', onError);
  }, []);

  // Tell the parent once a preview has actually rendered (or errored), so it can
  // keep its loading state up until the NEW content is on screen instead of
  // hiding it the moment compilation finishes (which would flash the old one).
  //
  // A preview that failed says why, once: the parent shows the error, and
  // offers to have it fixed, outside the sandbox where it can.
  useEffect(() => {
    if (
      runtimeError ||
      state.status === 'element' ||
      state.status === 'component' ||
      state.status === 'markup' ||
      state.status === 'error'
    ) {
      window.parent.postMessage({ type: 'artifact-preview-rendered' }, '*');
    }
    const failure =
      runtimeError ?? (state.status === 'error' ? state.message : null);
    if (failure) {
      window.parent.postMessage(
        { type: 'artifact-preview-error', message: failure },
        '*'
      );
    }
  }, [state, runtimeError]);

  useEffect(() => {
    installMemoryStorage();
    // Which render is current: one that waited on a package or on Mermaid
    // gives way to any sent after it.
    let latestRender = 0;

    const handleMessage = async (event: MessageEvent<PreviewMessage>) => {
      // Only accept render instructions from the embedding parent window.
      // Defense in depth: the frame is already sandboxed to an opaque origin,
      // but this rejects messages from any other window/script.
      if (event.source !== window.parent) return;
      if (
        event.data?.type !== 'artifact-preview-render' &&
        event.data?.type !== 'artifact-preview-mermaid'
      ) {
        return;
      }
      // This page runs whatever it is sent. That is only safe inside the
      // sandbox the app puts it in, where the origin is opaque. The sandbox is
      // an attribute of the embedding iframe, though, not of this page — so
      // another site can frame this address without one, and what it sent
      // would then run as this origin. Opaque or nothing.
      if (window.origin !== 'null') return;

      const render = ++latestRender;
      const message = event.data;
      setRuntimeError(null);
      setRenderNonce(nonce => nonce + 1);

      try {
        if (message.type === 'artifact-preview-mermaid') {
          const { default: mermaid } = await import('mermaid');
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
          const { svg } = await mermaid.render(
            `mermaid-${render}`,
            message.source
          );
          if (render !== latestRender) return;
          setState({ status: 'markup', html: svg });
          return;
        }

        await Promise.all((message.imports ?? []).map(loadPackage));
        if (render !== latestRender) return;

        let sideEffectRendered = false;
        const renderElement = (element: React.ReactElement) => {
          sideEffectRendered = true;
          setState({ status: 'element', element });
        };

        const moduleCache = new Map<string, unknown>();
        // Some artifacts are emitted under two virtual paths with identical
        // content (filename- and export-name-based) so relative imports resolve
        // either way. Cache by code so the module evaluates exactly once.
        const codeCache = new Map<string, unknown>();

        const executeModule = (modulePath: string): unknown => {
          if (moduleCache.has(modulePath)) {
            return moduleCache.get(modulePath);
          }

          const code = message.files[modulePath];
          if (!code) {
            throw new Error(`Module not found: ${modulePath}`);
          }

          if (codeCache.has(code)) {
            const cached = codeCache.get(code);
            moduleCache.set(modulePath, cached);
            return cached;
          }

          const exportsObject: Record<string, unknown> = {};
          const moduleObject: { exports: Record<string, unknown> | unknown } = {
            exports: exportsObject
          };

          const localRequire = (specifier: string) => {
            if (specifier === 'react') {
              return { ...React, default: React };
            }
            if (specifier === 'react-dom') {
              return {
                render(node: React.ReactElement) {
                  renderElement(node);
                }
              };
            }
            if (specifier === 'react-dom/client') {
              return {
                createRoot() {
                  return {
                    render(node: React.ReactElement) {
                      renderElement(node);
                    },
                    unmount() {}
                  };
                }
              };
            }
            if (loadedPackages.has(specifier as PreviewPackage)) {
              return loadedPackages.get(specifier as PreviewPackage);
            }
            if (specifier.startsWith('./') || specifier.startsWith('../')) {
              if (specifier.endsWith('.css')) {
                return {};
              }

              const resolvedPath = resolveImportPath(
                specifier,
                modulePath,
                message.files
              );
              if (!resolvedPath) {
                throw new Error(`Unsupported import: ${specifier}`);
              }
              if (resolvedPath.endsWith('.css')) {
                return {};
              }
              return executeModule(resolvedPath);
            }
            throw new Error(`Unsupported import: ${specifier}`);
          };

          const evaluate = new Function(
            'exports',
            'module',
            'require',
            'React',
            `${code}\nreturn module.exports;`
          ) as (
            exports: Record<string, unknown>,
            module: { exports: Record<string, unknown> | unknown },
            require: (specifier: string) => unknown,
            react: typeof React
          ) => unknown;

          const executed = evaluate(
            exportsObject,
            moduleObject,
            localRequire,
            React
          );
          const exported =
            (executed as Record<string, unknown> | undefined) ??
            moduleObject.exports;

          moduleCache.set(modulePath, exported);
          codeCache.set(code, exported);
          return exported;
        };

        const exported = executeModule(message.entryPath) as
          Record<string, unknown> | undefined;

        if (sideEffectRendered) {
          return;
        }

        const component =
          (exported as { default?: unknown }).default ?? exported;

        if (React.isValidElement(component)) {
          setState({ status: 'element', element: component });
          return;
        }

        if (typeof component === 'function') {
          setState({
            status: 'component',
            component: component as React.ComponentType
          });
          return;
        }

        if (!sideEffectRendered) {
          throw new Error(
            'Preview code must export a React component or JSX element as default.'
          );
        }
      } catch (error) {
        if (render !== latestRender) return;
        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to render preview'
        });
      }
    };

    const onMessage = (event: MessageEvent<PreviewMessage>) =>
      void handleMessage(event);
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'artifact-preview-frame-ready' }, '*');

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, []);

  // The parent shows the error; the page stays blank behind it.
  if (runtimeError || state.status === 'error') {
    return <div className="min-h-screen bg-white" />;
  }

  if (state.status === 'element' || state.status === 'component') {
    const Component =
      state.status === 'component' ? state.component : undefined;
    return (
      <div className="min-h-screen bg-white p-4 text-slate-900">
        <PreviewErrorBoundary resetKey={renderNonce} onError={setRuntimeError}>
          {state.status === 'element' ? (
            state.element
          ) : Component ? (
            <Component />
          ) : null}
        </PreviewErrorBoundary>
      </div>
    );
  }

  // A Mermaid diagram, as the SVG Mermaid drew — sanitised by it, on its
  // strict level, and shown in the sandbox like everything else here.
  if (state.status === 'markup') {
    return (
      <div
        className="flex min-h-screen justify-center bg-white p-4"
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
    );
  }

  return <div className="min-h-screen bg-white p-4" />;
}
