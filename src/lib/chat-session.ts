import { Chat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  type ChatOnDataCallback,
  type ChatOnErrorCallback
} from 'ai';

import { type ChatMessage } from '@/types';
import { generateUUID, getMostRecentUserMessage } from '@/lib/utils';

/**
 * A chat's live stream, held outside the route tree.
 *
 * A new conversation starts on `/` and moves to `/chat/<id>` the moment the
 * server names it. Those are two different routes, so the router unmounts one
 * page and mounts the other — and a `useChat` that owns its own `Chat` goes
 * with it, taking the reply being streamed into it. The swap runs in a
 * transition, which React keeps restarting while stream updates arrive, so it
 * lands exactly when the turn ends: the finished answer blanked out and then
 * reappeared, re-fetched, a moment later.
 *
 * Keeping the `Chat` here means the two pages share one conversation. Whichever
 * one is mounted reads the same messages and the same status, and a route
 * change is no longer something a turn has to survive.
 */
export interface ChatSession {
  chat: Chat<ChatMessage>;
  /**
   * True until a page has mounted on this session. It is what tells that first
   * page it may re-attach to a generation still running on the server — a
   * reload, or a tab reopened mid-turn. A later page reached this session by
   * moving between routes, and the turn it would "resume" is the one already
   * streaming into it: a second reader of the same stream would write the
   * reply into the message twice.
   */
  isNew: boolean;
  /**
   * What the *currently mounted* page wants sent with the next turn — model,
   * reasoning, media options. The session outlives any one mount, so this is
   * re-stated on every render rather than captured when the chat was built.
   */
  requestBody: Record<string, unknown>;
  /**
   * Likewise for the stream callbacks: they belong to the mounted page (they
   * set its title, roll its model selector back), so they are handed over
   * rather than baked in.
   */
  handlers: {
    onData?: ChatOnDataCallback<ChatMessage>;
    onError?: ChatOnErrorCallback;
  };
}

const sessions = new Map<string, ChatSession>();
const pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * How long a session outlives the page that was showing it. Long enough to
 * cover an unmount and remount in the same commit — which is all the route
 * swap is — and short enough that coming back to a chat later reads it from
 * the server again.
 */
const RELEASE_DELAY_MS = 5_000;

/**
 * How many times a release waits for a turn to finish before dropping the
 * session anyway. A stream that stops arriving without ever ending — a server
 * that never closes the body, a connection the transport does not give up on —
 * would otherwise re-arm the timer for the life of the tab.
 */
const MAX_RELEASE_DEFERRALS = 12;

const cancelRelease = (id: string) => {
  const pending = pendingReleases.get(id);
  if (pending) {
    clearTimeout(pending);
    pendingReleases.delete(id);
  }
};

const scheduleRelease = (id: string, deferrals = 0) => {
  cancelRelease(id);

  pendingReleases.set(
    id,
    setTimeout(() => {
      pendingReleases.delete(id);

      const session = sessions.get(id);
      if (!session) return;

      const { status } = session.chat;
      const streaming = status === 'submitted' || status === 'streaming';
      if (streaming && deferrals < MAX_RELEASE_DEFERRALS) {
        scheduleRelease(id, deferrals + 1);
        return;
      }

      sessions.delete(id);
    }, RELEASE_DELAY_MS)
  );
};

function createSession(
  id: string,
  initialMessages: ChatMessage[]
): ChatSession {
  const session: ChatSession = {
    chat: undefined as unknown as Chat<ChatMessage>,
    isNew: true,
    requestBody: {},
    handlers: {}
  };

  session.chat = new Chat<ChatMessage>({
    id,
    messages: initialMessages,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest({ messages, body }) {
        const userMessage = getMostRecentUserMessage(messages);
        return {
          body: {
            id,
            userMessage,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...session.requestBody,
            ...body
          }
        };
      },
      // Resume hits the same route as a GET; pass the chat id as a query
      // param so the handler knows which stream to re-attach to.
      prepareReconnectToStreamRequest({ id, api }) {
        return { api: `${api}?chatId=${id}` };
      }
    }),
    onData: dataPart => session.handlers.onData?.(dataPart),
    onError: error => session.handlers.onError?.(error)
  });

  return session;
}

/**
 * The session for `id`, created from `initialMessages` if this is the first
 * time the chat is opened. An existing session is returned as it stands:
 * it is the running conversation, and the messages the server has persisted
 * so far are behind it.
 */
export function getChatSession(
  id: string,
  initialMessages: ChatMessage[]
): ChatSession {
  // Rendering on the server reaches here too, and there this module belongs to
  // the process rather than to a reader: a cache would hand one request's
  // conversation to the next, and nothing would ever drop it — the release
  // runs from an effect, which the server never gets to. A server render is
  // one shot, so it gets a session of its own and lets it go.
  if (typeof window === 'undefined') {
    return createSession(id, initialMessages);
  }

  const existing = sessions.get(id);
  if (existing) return existing;

  const session = createSession(id, initialMessages);
  sessions.set(id, session);
  // Armed from birth, and cancelled by the page that mounts on it. This runs
  // during render, which React is free to throw away — a session nobody ends
  // up showing has to go of its own accord, and cancelling a pending release
  // here would let a discarded render pin one for the life of the tab.
  scheduleRelease(id);
  return session;
}

/**
 * A page is showing this chat: keep the session, cancelling any release the
 * page it replaced scheduled. React tears the old page down before it runs the
 * new one's effects, so this is what settles the handover.
 */
export function retainChatSession(id: string) {
  cancelRelease(id);
}

/**
 * The page showing this chat has gone away. Drop the session shortly after —
 * unless a turn is still running, in which case it is kept until it finishes
 * so navigating away and back lands on the whole reply.
 */
export function releaseChatSession(id: string) {
  scheduleRelease(id);
}
