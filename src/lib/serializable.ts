import type { ChatMessage } from '@/types';
import type { VertexServiceAccountKey } from '@/types/provider';

/**
 * Widens what a server function is allowed to return.
 *
 * Start proves a return value is serializable from its type. These are
 * serializable by construction — both are read straight out of JSONB columns —
 * but their types carry open-ended fields the checker cannot see through, so
 * it refuses them.
 *
 * Stating the fact here rather than casting at each call site keeps a
 * genuinely unserializable value from slipping through the day one appears.
 */
declare module '@tanstack/router-core' {
  interface SerializableExtensions {
    chatMessage: ChatMessage;
    // A message's parts are matched one at a time, and a tool part carries an
    // input and output whose shape is the tool's own — `unknown` to everyone
    // else. They come out of a JSONB column, so they are JSON by construction.
    chatMessagePart: ChatMessage['parts'][number];
    vertexServiceAccountKey: VertexServiceAccountKey;
  }
}

export {};
