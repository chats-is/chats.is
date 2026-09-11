import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChatMessage } from '@/types';
import {
  getChatSession,
  releaseChatSession,
  retainChatSession
} from '@/lib/chat-session';

/**
 * A hand-driven `/api/chat` response. The test decides when each SSE chunk
 * lands, which is what lets it pull the page out from under a turn that is
 * still streaming — the thing the session exists to survive.
 */
function openStream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });

  return {
    body,
    send(chunk: unknown) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    },
    end() {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  };
}

type Request = { url: string; body: Record<string, any> };

function stubChatApi() {
  const requests: Request[] = [];
  const streams: ReturnType<typeof openStream>[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      const stream = openStream();
      streams.push(stream);
      return new Response(stream.body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    })
  );

  return { requests, streams };
}

const textOf = (message: ChatMessage | undefined) =>
  (message?.parts ?? [])
    .filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('');

describe('a turn that outlives the page showing it', () => {
  beforeEach(() => {
    // These tests are about what the browser keeps between two pages; the module
    // hands a server render a throwaway session instead, so say which side we are.
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps streaming into the same conversation across a route swap', async () => {
    const { requests, streams } = stubChatApi();

    // The page on `/`: it opens the chat and takes the stream callbacks.
    const session = getChatSession('swap', []);
    retainChatSession('swap');
    const firstPageParts: string[] = [];
    session.handlers.onData = part => firstPageParts.push(part.type);
    session.requestBody = { modelId: 'model-a' };
    session.isNew = false;

    const turn = session.chat.sendMessage({ text: 'hi' });

    await vi.waitFor(() => expect(streams).toHaveLength(1));
    expect(requests[0].url).toBe('/api/chat');
    expect(requests[0].body.modelId).toBe('model-a');
    expect(requests[0].body.userMessage.parts[0].text).toBe('hi');

    const stream = streams[0];
    stream.send({ type: 'start', messageId: 'assistant-1' });
    stream.send({ type: 'start-step' });
    stream.send({ type: 'text-start', id: 't1' });
    stream.send({ type: 'text-delta', id: 't1', delta: 'Hel' });

    await vi.waitFor(() =>
      expect(textOf(session.chat.messages.at(-1))).toBe('Hel')
    );

    // The swap: the router tears down `/` and mounts `/chat/swap`, whose loader
    // only knows about the message the user sent.
    releaseChatSession('swap');
    const remounted = getChatSession('swap', [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
    ]);
    retainChatSession('swap');

    // What the reader sees first: the half-written reply is still there, and
    // it is the same conversation rather than a copy built from the loader.
    expect(textOf(remounted.chat.messages.at(-1))).toBe('Hel');
    expect(remounted).toBe(session);

    // The new page takes over the callbacks.
    const secondPageParts: string[] = [];
    remounted.handlers.onData = part => secondPageParts.push(part.type);

    stream.send({ type: 'data-chat', data: { title: 'Named' } });
    stream.send({ type: 'text-delta', id: 't1', delta: 'lo world' });
    stream.send({ type: 'text-end', id: 't1' });
    stream.send({ type: 'finish-step' });
    stream.send({ type: 'finish' });
    stream.end();

    await turn;

    // Nothing was lost in the middle, and nothing was re-fetched to recover it.
    expect(textOf(session.chat.messages.at(-1))).toBe('Hello world');
    expect(session.chat.messages).toHaveLength(2);
    expect(session.chat.status).toBe('ready');
    expect(requests).toHaveLength(1);

    // The part that arrived after the swap reached the page that was showing
    // the chat, not the one that had been torn down.
    expect(firstPageParts).not.toContain('data-chat');
    expect(secondPageParts).toContain('data-chat');
  });

  it('sends what the page showing it now has selected', async () => {
    const { requests, streams } = stubChatApi();

    const session = getChatSession('handover', []);
    retainChatSession('handover');
    session.isNew = false;
    session.requestBody = { modelId: 'model-a' };

    const first = session.chat.sendMessage({ text: 'one' });
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0].send({ type: 'start', messageId: 'a1' });
    streams[0].send({ type: 'finish' });
    streams[0].end();
    await first;

    // A different page, with a different model selected, is now mounted on it.
    releaseChatSession('handover');
    const remounted = getChatSession('handover', []);
    retainChatSession('handover');
    remounted.requestBody = { modelId: 'model-b' };

    const second = remounted.chat.sendMessage({ text: 'two' });
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    streams[1].send({ type: 'start', messageId: 'a2' });
    streams[1].send({ type: 'finish' });
    streams[1].end();
    await second;

    expect(requests[0].body.modelId).toBe('model-a');
    expect(requests[1].body.modelId).toBe('model-b');
    expect(requests[1].body.userMessage.parts[0].text).toBe('two');
  });
});
