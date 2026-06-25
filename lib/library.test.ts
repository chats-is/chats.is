import { describe, expect, it } from 'vitest';

import { ChatMessage } from '@/types';

import { extractLibraryMedia } from './library';

const createdAt = new Date('2026-06-12T10:00:00Z');

function message(parts: any[]) {
  return {
    id: 'm1',
    chatId: 'c1',
    parts: parts as ChatMessage['parts'],
    createdAt
  };
}

describe('extractLibraryMedia', () => {
  it('extracts media tool outputs with the prompt as title', () => {
    const items = extractLibraryMedia(
      message([
        {
          type: 'tool-generate_image',
          toolCallId: 't1',
          state: 'output-available',
          input: { prompt: 'a cat in space' },
          output: {
            status: 'done',
            url: 'https://blob/cat.png',
            mediaType: 'image/png',
            filename: 'cat.png'
          }
        }
      ])
    );
    expect(items).toEqual([
      {
        id: 'm1:0',
        kind: 'image',
        url: 'https://blob/cat.png',
        mediaType: 'image/png',
        title: 'a cat in space',
        chatId: 'c1',
        messageId: 'm1',
        createdAt
      }
    ]);
  });

  it('extracts legacy file parts and classifies by media type', () => {
    const items = extractLibraryMedia(
      message([
        { type: 'file', mediaType: 'video/mp4', url: 'https://blob/v.mp4' },
        {
          type: 'file',
          mediaType: 'audio/mpeg',
          url: 'https://blob/a.mp3',
          filename: 'a.mp3'
        }
      ])
    );
    expect(items.map(i => i.kind)).toEqual(['video', 'audio']);
    expect(items[1].title).toBe('a.mp3');
  });

  it('uses the text as title for text_to_speech outputs', () => {
    const items = extractLibraryMedia(
      message([
        {
          type: 'tool-text_to_speech',
          toolCallId: 't1',
          state: 'output-available',
          input: { text: 'hello world' },
          output: {
            status: 'done',
            url: 'https://blob/s.mp3',
            mediaType: 'audio/mpeg',
            filename: 's.mp3'
          }
        }
      ])
    );
    expect(items[0].title).toBe('hello world');
  });

  it('skips errored tools, non-media tools, and text parts', () => {
    const items = extractLibraryMedia(
      message([
        { type: 'text', text: 'hi' },
        {
          type: 'tool-generate_image',
          toolCallId: 't1',
          state: 'output-available',
          input: { prompt: 'x' },
          output: { status: 'error', message: 'failed' }
        },
        {
          type: 'tool-transcribe_audio',
          toolCallId: 't2',
          state: 'output-available',
          input: { audioUrl: 'https://blob/a.mp3' },
          output: { status: 'done', text: 'transcript' }
        },
        {
          type: 'tool-create_artifact',
          toolCallId: 't3',
          state: 'output-available',
          input: { title: 'Doc', type: 'text' },
          output: { id: 'art-1' }
        }
      ])
    );
    expect(items).toEqual([]);
  });
});
