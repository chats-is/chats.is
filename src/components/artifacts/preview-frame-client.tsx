import React, { useEffect, useState } from 'react'
import * as classVarianceAuthority from 'class-variance-authority'
import clsx from 'clsx'
import * as framerMotion from 'framer-motion'
import * as lucideReact from 'lucide-react'
import * as recharts from 'recharts'

// Curated libraries bundled from our own origin and handed to the sandbox's
// require(), so previews can use them while staying fully offline (no CDN).
// `__esModule: true` makes the compiled CommonJS interop helpers treat these as
// ES modules instead of re-wrapping the default export.
const wrapModule = (mod: Record<string, unknown>) => ({
  __esModule: true,
  ...mod,
  default: (mod as { default?: unknown }).default ?? mod,
})

const PREVIEW_PACKAGE_MODULES: Record<string, unknown> = {
  'lucide-react': wrapModule(lucideReact),
  'framer-motion': wrapModule(framerMotion),
  recharts: wrapModule(recharts),
  clsx: { __esModule: true, default: clsx, clsx },
  'class-variance-authority': wrapModule(classVarianceAuthority),
}

type RenderState =
  | {
      status: 'idle'
    }
  | {
      status: 'error'
      message: string
    }
  | {
      status: 'element'
      element: React.ReactElement
    }
  | {
      status: 'component'
      component: React.ComponentType
    }

type PreviewMessage = {
  type: 'artifact-preview-render'
  entryPath: string
  files: Record<string, string>
}

// Catches errors thrown while rendering the previewed component so a runtime
// crash surfaces as a readable message instead of a blank frame. Resets itself
// whenever `resetKey` changes (i.e. a new preview is rendered).
class PreviewErrorBoundary extends React.Component<
  {
    resetKey: number
    onError: (message: string) => void
    children: React.ReactNode
  },
  { hasError: boolean; resetKey: number }
> {
  constructor(props: {
    resetKey: number
    onError: (message: string) => void
    children: React.ReactNode
  }) {
    super(props)
    this.state = { hasError: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: { resetKey: number },
    state: { hasError: boolean; resetKey: number },
  ) {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Preview crashed while rendering'
    this.props.onError(message)
    // Forward the caught render error as an error log so the parent surfaces it
    // (and auto-opens the console) — React doesn't reliably route ErrorBoundary
    // catches through the patched console.error, especially in production.
    try {
      window.parent.postMessage(
        { type: 'artifact-preview-log', level: 'error', message },
        '*',
      )
    } catch {}
  }

  render() {
    return this.state.hasError ? null : this.props.children
  }
}

const PreviewErrorView = ({ message }: { message: string }) => (
  <div className="min-h-screen bg-white p-4 text-red-700">
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <pre className="text-xs wrap-break-word whitespace-pre-wrap">
        {message}
      </pre>
    </div>
  </div>
)

const normalizePath = (value: string) => {
  const parts: string[] = []

  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return `/${parts.join('/')}`
}

const getDirectoryName = (value: string) => {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

const resolveImportPath = (
  specifier: string,
  fromPath: string,
  files: Record<string, string>,
) => {
  if (specifier.endsWith('.css')) {
    return normalizePath(`${getDirectoryName(fromPath)}/${specifier}`)
  }

  const basePath = normalizePath(`${getDirectoryName(fromPath)}/${specifier}`)
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ]

  return candidates.find((candidate) => files[candidate]) ?? null
}

export function ArtifactPreviewFrameClient() {
  const [state, setState] = useState<RenderState>({ status: 'idle' })
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [renderNonce, setRenderNonce] = useState(0)

  // Load the bundled Tailwind v4 browser runtime (served from our own origin,
  // no external CDN) so utility classes in previewed components are styled.
  // Imported lazily on the client because it touches `window`/`document`.
  useEffect(() => {
    void import('@tailwindcss/browser')
  }, [])

  // Surface uncaught runtime/async errors (the ErrorBoundary only catches
  // errors thrown during render) and forward console output to the parent.
  useEffect(() => {
    const forward = (level: 'error' | 'warn' | 'log', args: unknown[]) => {
      const message = args
        .map((arg) =>
          arg instanceof Error
            ? arg.message
            : typeof arg === 'string'
              ? arg
              : (() => {
                  try {
                    return JSON.stringify(arg)
                  } catch {
                    return String(arg)
                  }
                })(),
        )
        .join(' ')
      window.parent.postMessage(
        { type: 'artifact-preview-log', level, message },
        '*',
      )
    }

    const onError = (event: ErrorEvent) => {
      setRuntimeError(event.message || 'Runtime error in preview')
      forward('error', [event.message])
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      forward('error', [reason instanceof Error ? reason.message : reason])
    }

    const original = { error: console.error, warn: console.warn }
    console.error = (...args: unknown[]) => {
      forward('error', args)
      original.error(...args)
    }
    console.warn = (...args: unknown[]) => {
      forward('warn', args)
      original.warn(...args)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      console.error = original.error
      console.warn = original.warn
    }
  }, [])

  // Tell the parent once a preview has actually rendered (or errored), so it can
  // keep its loading state up until the NEW content is on screen instead of
  // hiding it the moment compilation finishes (which would flash the old one).
  useEffect(() => {
    if (
      runtimeError ||
      state.status === 'element' ||
      state.status === 'component' ||
      state.status === 'error'
    ) {
      window.parent.postMessage({ type: 'artifact-preview-rendered' }, '*')
    }
  }, [state, runtimeError])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<PreviewMessage>) => {
      // Only accept render instructions from the embedding parent window.
      // Defense in depth: the frame is already sandboxed to an opaque origin,
      // but this rejects messages from any other window/script.
      if (event.source !== window.parent) return
      if (event.data?.type !== 'artifact-preview-render') return

      setRuntimeError(null)
      setRenderNonce((nonce) => nonce + 1)

      try {
        let sideEffectRendered = false
        const renderElement = (element: React.ReactElement) => {
          sideEffectRendered = true
          setState({ status: 'element', element })
        }

        const moduleCache = new Map<string, unknown>()
        // Some artifacts are emitted under two virtual paths with identical
        // content (filename- and export-name-based) so relative imports resolve
        // either way. Cache by code so the module evaluates exactly once.
        const codeCache = new Map<string, unknown>()

        const executeModule = (modulePath: string): unknown => {
          if (moduleCache.has(modulePath)) {
            return moduleCache.get(modulePath)
          }

          const code = event.data.files[modulePath]
          if (!code) {
            throw new Error(`Module not found: ${modulePath}`)
          }

          if (codeCache.has(code)) {
            const cached = codeCache.get(code)
            moduleCache.set(modulePath, cached)
            return cached
          }

          const exportsObject: Record<string, unknown> = {}
          const moduleObject: { exports: Record<string, unknown> | unknown } = {
            exports: exportsObject,
          }

          const localRequire = (specifier: string) => {
            if (specifier === 'react') {
              return { ...React, default: React }
            }
            if (specifier === 'react-dom') {
              return {
                render(node: React.ReactElement) {
                  renderElement(node)
                },
              }
            }
            if (specifier === 'react-dom/client') {
              return {
                createRoot() {
                  return {
                    render(node: React.ReactElement) {
                      renderElement(node)
                    },
                    unmount() {},
                  }
                },
              }
            }
            if (specifier in PREVIEW_PACKAGE_MODULES) {
              return PREVIEW_PACKAGE_MODULES[specifier]
            }
            if (specifier.startsWith('./') || specifier.startsWith('../')) {
              if (specifier.endsWith('.css')) {
                return {}
              }

              const resolvedPath = resolveImportPath(
                specifier,
                modulePath,
                event.data.files,
              )
              if (!resolvedPath) {
                throw new Error(`Unsupported import: ${specifier}`)
              }
              if (resolvedPath.endsWith('.css')) {
                return {}
              }
              return executeModule(resolvedPath)
            }
            throw new Error(`Unsupported import: ${specifier}`)
          }

          const evaluate = new Function(
            'exports',
            'module',
            'require',
            'React',
            `${code}\nreturn module.exports;`,
          ) as (
            exports: Record<string, unknown>,
            module: { exports: Record<string, unknown> | unknown },
            require: (specifier: string) => unknown,
            react: typeof React,
          ) => unknown

          const executed = evaluate(
            exportsObject,
            moduleObject,
            localRequire,
            React,
          )
          const exported =
            (executed as Record<string, unknown> | undefined) ??
            moduleObject.exports

          moduleCache.set(modulePath, exported)
          codeCache.set(code, exported)
          return exported
        }

        const exported = executeModule(event.data.entryPath) as
          Record<string, unknown> | undefined

        if (sideEffectRendered) {
          return
        }

        const component =
          (exported as { default?: unknown }).default ?? exported

        if (React.isValidElement(component)) {
          setState({ status: 'element', element: component })
          return
        }

        if (typeof component === 'function') {
          setState({
            status: 'component',
            component: component as React.ComponentType,
          })
          return
        }

        if (!sideEffectRendered) {
          throw new Error(
            'Preview code must export a React component or JSX element as default.',
          )
        }
      } catch (error) {
        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to render preview',
        })
      }
    }

    window.addEventListener('message', handleMessage)
    window.parent.postMessage({ type: 'artifact-preview-frame-ready' }, '*')

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  if (runtimeError) {
    return <PreviewErrorView message={runtimeError} />
  }

  if (state.status === 'error') {
    return <PreviewErrorView message={state.message} />
  }

  if (state.status === 'element' || state.status === 'component') {
    const Component = state.status === 'component' ? state.component : undefined
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
    )
  }

  return <div className="min-h-screen bg-white p-4" />
}
