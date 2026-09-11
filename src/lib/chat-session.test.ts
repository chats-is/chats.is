import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChatMessage } from '@/types';
import {
  getChatSession,
  releaseChatSession,
  retainChatSession
} from '@/lib/chat-session';

const message = (id: string, text: string): ChatMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }]
});

describe('chat sessions', () => {
  beforeEach(() => {
    // These tests are about what the browser keeps between two pages; the module
    // hands a server render a throwaway session instead, so say which side we are.
    vi.stubGlobal('window', globalThis);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('hands the same conversation to the next page that asks for it', () => {
    const first = getChatSession('chat-1', []);
    const second = getChatSession('chat-1', [message('m1', 'from the loader')]);

    // The point of the whole module: `/` and `/chat/<id>` are different routes
    // showing one conversation, and the second must not restart it from what
    // the server had persisted when the turn began.
    expect(second).toBe(first);
    expect(second.chat.messages).toEqual([]);
  });

  it('only offers to resume to the page that opened the chat', () => {
    const opened = getChatSession('chat-2', []);
    expect(opened.isNew).toBe(true);

    // What the mounting page does once it has read the flag.
    opened.isNew = false;

    expect(getChatSession('chat-2', []).isNew).toBe(false);
  });

  it('survives the unmount and remount of a route swap', () => {
    const before = getChatSession('chat-3', []);
    before.isNew = false;
    before.chat.messages = [message('m1', 'mid-turn')];

    // React tears the old page down, then mounts the new one.
    releaseChatSession('chat-3');
    retainChatSession('chat-3');
    vi.runAllTimers();

    const after = getChatSession('chat-3', []);
    expect(after).toBe(before);
    expect(after.chat.messages).toHaveLength(1);
  });

  it('drops a session no page ever mounted on', () => {
    // A render React threw away: it reached the module, but no page followed.
    const abandoned = getChatSession('chat-abandoned', []);
    vi.runAllTimers();

    expect(getChatSession('chat-abandoned', [])).not.toBe(abandoned);
  });

  it('keeps a session the moment a page claims it', () => {
    const claimed = getChatSession('chat-claimed', []);
    retainChatSession('chat-claimed');
    vi.runAllTimers();

    expect(getChatSession('chat-claimed', [])).toBe(claimed);
  });

  it('drops a chat nothing is showing, and reads it back from the server', () => {
    const before = getChatSession('chat-4', []);
    before.chat.messages = [message('m1', 'stale')];

    releaseChatSession('chat-4');
    vi.runAllTimers();

    const after = getChatSession('chat-4', [message('m2', 'from the loader')]);
    expect(after).not.toBe(before);
    expect(after.isNew).toBe(true);
    expect(after.chat.messages).toEqual([message('m2', 'from the loader')]);
  });
});

describe('rendering on the server', () => {
  it('never caches, because the process is shared and nothing releases it', () => {
    // No `window`: this is a server render.
    const first = getChatSession('chat-ssr', [message('m1', 'one')]);
    const second = getChatSession('chat-ssr', [message('m2', 'two')]);

    expect(second).not.toBe(first);
    expect(second.chat.messages).toEqual([message('m2', 'two')]);
  });
});
