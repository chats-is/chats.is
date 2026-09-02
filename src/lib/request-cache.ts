import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Memoises a read for the length of one request.
 *
 * Settings are consulted several times while a single request is served — the
 * system prompt, the title model, the quota default — and each of those reads
 * would otherwise be its own round trip. Within a request the answer cannot
 * change, so the first call decides it.
 *
 * Deliberately per-request rather than for a span of time: an admin who
 * changes a setting sees it on their next request, exactly as before.
 */
const store = new AsyncLocalStorage<Map<string, unknown>>();

/** Runs `fn` with a fresh scope. Everything below it shares one set of answers. */
export function withRequestScope<T>(fn: () => T): T {
  return store.run(new Map(), fn);
}

export function perRequest<TArgs extends Array<unknown>, TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return (...args) => {
    const scope = store.getStore();
    // No scope means no request — a script, a test, a build step. Read through.
    if (!scope) return fn(...args);

    const key = args.length ? `${name}:${JSON.stringify(args)}` : name;
    const hit = scope.get(key);
    if (hit !== undefined) return hit as Promise<TResult>;

    const pending = fn(...args);
    scope.set(key, pending);
    return pending;
  };
}
