import 'server-only';

import { after } from 'next/server';
import { createClient } from 'redis';
import {
  createResumableStreamContext,
  type ResumableStreamContext
} from 'resumable-stream';

import { env } from '@/lib/env';

// `undefined` = not yet initialized; `null` = disabled (no REDIS_URL) so resume
// falls back to one-shot streaming. A successful context is cached forever; a
// connect failure is NOT cached, so a later request can retry.
let cached: ResumableStreamContext | null | undefined;
let inflight: Promise<ResumableStreamContext | null> | undefined;

async function init(): Promise<ResumableStreamContext | null> {
  try {
    // Own the redis clients instead of letting resumable-stream auto-create
    // them: that way we can attach 'error' handlers. An unhandled node-redis
    // 'error' event (e.g. when Upstash drops an idle connection on the
    // long-lived singleton) is otherwise thrown and crashes the resume call
    // with an opaque empty error. Pub/sub needs a dedicated subscriber
    // connection, hence duplicate().
    const publisher = createClient({ url: env.REDIS_URL });
    const subscriber = publisher.duplicate();
    publisher.on('error', e =>
      console.error('[resumable-stream] redis publisher error:', e?.message)
    );
    subscriber.on('error', e =>
      console.error('[resumable-stream] redis subscriber error:', e?.message)
    );
    await Promise.all([publisher.connect(), subscriber.connect()]);
    return createResumableStreamContext({
      waitUntil: promise => after(promise),
      publisher,
      subscriber
    });
  } catch (err) {
    console.error('[resumable-stream] failed to init context:', err);
    return null;
  }
}

/**
 * The resumable-stream context, or null when REDIS_URL is unset. Used to let an
 * in-progress chat generation survive a page refresh: the client reconnects to
 * the buffered stream via the chat route's GET handler instead of losing it.
 */
export async function getResumableStreamContext(): Promise<ResumableStreamContext | null> {
  if (cached !== undefined) return cached;
  if (!env.REDIS_URL) {
    cached = null;
    return cached;
  }
  if (!inflight) inflight = init();
  const ctx = await inflight;
  if (ctx) {
    cached = ctx;
  } else {
    // Don't cache a failed init — let the next request retry the connection.
    inflight = undefined;
  }
  return ctx;
}
