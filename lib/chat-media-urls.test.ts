import { describe, expect, it } from 'vitest';

import { ChatMessage } from '@/types';

import { collectConversationMediaUrls } from './chat-media-urls';

function message(parts: any[], role: 'user' | 'assistant' = 'user') {
  return { id: 'm1', role, parts } as ChatMessage;
}

describe('collectConversationMediaUrls', () => {
  it('collects file part urls (user uploads and persisted generations)', () => {
    const urls = collectConversationMediaUrls([
      message([
        { type: 'text', text: 'look at this' },
        { type: 'file', mediaType: 'image/png', url: 'https://blob/x.png' }
      ])
    ]);
    expect(urls).toEqual(new Set(['https://blob/x.png']));
  });

  it('collects successful media tool output urls', () => {
    const urls = collectConversationMediaUrls([
      message(
        [
          {
            type: 'tool-generate_image',
            toolCallId: 'c1',
            state: 'output-available',
            input: { prompt: 'a cat' },
            output: {
              status: 'done',
              url: 'https://blob/cat.png',
              mediaType: 'image/png',
              filename: 'cat.png'
            }
          }
        ],
        'assistant'
      )
    ]);
    expect(urls.has('https://blob/cat.png')).toBe(true);
  });

  it('ignores tool errors, non-tool parts, and parts without urls', () => {
    const urls = collectConversationMediaUrls([
      message(
        [
          { type: 'text', text: 'hi' },
          {
            type: 'tool-generate_image',
            toolCallId: 'c1',
            state: 'output-available',
            input: { prompt: 'a cat' },
            output: { status: 'error', message: 'failed' }
          },
          {
            type: 'tool-create_artifact',
            toolCallId: 'c2',
            state: 'output-available',
            input: { title: 'Doc', type: 'text' },
            output: { id: 'artifact-1' }
          }
        ],
        'assistant'
      )
    ]);
    expect(urls.size).toBe(0);
  });

  it('handles messages without parts', () => {
    expect(
      collectConversationMediaUrls([{ id: 'm', role: 'user' } as ChatMessage])
    ).toEqual(new Set());
  });
});
