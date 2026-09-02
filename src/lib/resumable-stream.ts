import '@tanstack/react-start/server-only'

import { waitUntil } from '@vercel/functions'
import { createClient } from 'redis'
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream'

import { env } from '@/lib/env'

// `undefined` = not yet initialized; `null` = disabled (no REDIS_URL) so resume
// falls back to one-shot streaming. A successful context is cached forever; a
// connect failure is NOT cached, so a later request can retry.
/** Upper bound on the initial connect; see the socket options below. */
const CONNECT_TIMEOUT_MS = 5000

/** Reconnect attempts before a client gives up. See `reconnectStrategy`. */
const MAX_RECONNECT_ATTEMPTS = 3

let cached: ResumableStreamContext | null | undefined
let inflight: Promise<ResumableStreamContext | null> | undefined

async function init(): Promise<ResumableStreamContext | null> {
  try {
    // Own the redis clients instead of letting resumable-stream auto-create
    // them: that way we can attach 'error' handlers. An unhandled node-redis
    // 'error' event (e.g. when Upstash drops an idle connection on the
    // long-lived singleton) is otherwise thrown and crashes the resume call
    // with an opaque empty error. Pub/sub needs a dedicated subscriber
    // connection, hence duplicate().
    const publisher = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Retry a few times, then give up. node-redis retries forever by
        // default, and connectTimeout does not cover that: against a host that
        // no longer resolves, connect() stays pending instead of rejecting —
        // and the chat route awaits this before it streams, so every request
        // hangs rather than falling back to a one-shot stream. Resume is a
        // nicety; it must never be able to take chat down with it.
        //
        // Bounded rather than disabled, because the connection is a long-lived
        // singleton and hosted Redis drops it when idle — that has to heal on
        // its own, it just must not retry indefinitely.
        reconnectStrategy: (retries) =>
          retries >= MAX_RECONNECT_ATTEMPTS
            ? new Error('redis unreachable, giving up')
            : Math.min((retries + 1) * 200, 1000),
      },
    })
    const subscriber = publisher.duplicate()
    publisher.on('error', (e) =>
      console.error('[resumable-stream] redis publisher error:', e?.message),
    )
    subscriber.on('error', (e) =>
      console.error('[resumable-stream] redis subscriber error:', e?.message),
    )
    try {
      await Promise.all([publisher.connect(), subscriber.connect()])
    } catch (err) {
      // Don't leave half-open clients behind retrying in the background.
      await Promise.allSettled([publisher.destroy(), subscriber.destroy()])
      throw err
    }

    return createResumableStreamContext({
      waitUntil: (promise) => waitUntil(promise),
      publisher,
      subscriber,
    })
  } catch (err) {
    console.error('[resumable-stream] failed to init context:', err)
    return null
  }
}

/**
 * The resumable-stream context, or null when REDIS_URL is unset. Used to let an
 * in-progress chat generation survive a page refresh: the client reconnects to
 * the buffered stream via the chat route's GET handler instead of losing it.
 */
export async function getResumableStreamContext(): Promise<ResumableStreamContext | null> {
  if (cached !== undefined) return cached
  if (!env.REDIS_URL) {
    cached = null
    return cached
  }
  if (!inflight) inflight = init()
  const ctx = await inflight
  if (ctx) {
    cached = ctx
  } else {
    // Don't cache a failed init — let the next request retry the connection.
    inflight = undefined
  }
  return ctx
}
