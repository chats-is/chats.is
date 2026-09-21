import { describe, expect, it } from 'vitest';

import { type ChatMessage } from '@/types';

import { fitToContext } from './context-window';

/** A message of roughly `tokens` tokens: four ASCII characters to one. */
const message = (
  id: string,
  role: 'user' | 'assistant',
  tokens: number
): ChatMessage => ({
  id,
  role,
  parts: [{ type: 'text', text: 'x'.repeat(tokens * 4) }]
});

const chat = [
  message('u1', 'user', 100),
  message('a1', 'assistant', 100),
  message('u2', 'user', 100),
  message('a2', 'assistant', 100),
  message('u3', 'user', 100)
];

const ids = (messages: ChatMessage[]) => messages.map(m => m.id);

describe('fitToContext', () => {
  it('leaves a conversation that fits alone', () => {
    expect(fitToContext(chat, 10_000)).toEqual({ messages: chat, dropped: 0 });
  });

  it('forgets the beginning, and begins again with the user speaking', () => {
    // Room for three and a bit — which would start on a1, an answer to a
    // question that is no longer there.
    const fitted = fitToContext(chat, 350);

    expect(ids(fitted.messages)).toEqual(['u2', 'a2', 'u3']);
    expect(fitted.dropped).toBe(2);
  });

  it('keeps the message being answered even when nothing else fits', () => {
    expect(ids(fitToContext(chat, 10).messages)).toEqual(['u3']);
  });

  it('counts text outside ASCII for what it costs, not by fours', () => {
    const chinese: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: '你'.repeat(400) }]
      },
      message('a1', 'assistant', 10),
      message('u2', 'user', 10)
    ];

    // 400 characters is 100 tokens by fours and would fit; it is 400, and
    // does not.
    expect(ids(fitToContext(chinese, 200).messages)).toEqual(['u2']);
  });
});
