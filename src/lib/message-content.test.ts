import { describe, expect, it } from 'vitest';

import { type ChatMessage } from '@/types';

import { hasVisibleContent, markStopped } from './message-content';

type Part = ChatMessage['parts'][number];

const running = (id: string): Part => ({
  type: 'tool-web_search',
  toolCallId: id,
  state: 'input-available',
  input: { query: 'q' }
});

const done: Part = {
  type: 'tool-generate_image',
  toolCallId: 'img',
  state: 'output-available',
  input: { prompt: 'a cat' },
  output: {
    status: 'done',
    url: 'https://x',
    mediaType: 'image/png',
    filename: 'c.png'
  }
};

describe('hasVisibleContent', () => {
  it('counts words, files, the incomplete note and a finished tool', () => {
    expect(hasVisibleContent([{ type: 'text', text: 'hi' }])).toBe(true);
    expect(
      hasVisibleContent([{ type: 'text', text: '', state: 'streaming' }])
    ).toBe(true);
    expect(hasVisibleContent([{ type: 'reasoning', text: 'because' }])).toBe(
      true
    );
    expect(
      hasVisibleContent([{ type: 'file', url: 'u', mediaType: 'image/png' }])
    ).toBe(true);
    expect(
      hasVisibleContent([
        { type: 'data-error', data: { kind: 'incomplete', message: 'x' } }
      ])
    ).toBe(true);
    expect(hasVisibleContent([done])).toBe(true);
  });

  it('does not count a finished artifact or transcript: the card and the words come from elsewhere', () => {
    expect(
      hasVisibleContent([
        {
          type: 'tool-create_artifact',
          toolCallId: 'a',
          state: 'output-available',
          input: { title: 't', type: 'text' },
          output: { id: 'x' }
        },
        {
          type: 'tool-transcribe_audio',
          toolCallId: 't',
          state: 'output-available',
          input: { audioUrl: 'https://x' },
          output: { status: 'done', text: 'hello' }
        }
      ])
    ).toBe(false);
  });

  it('reads the legacy reasoning field an older row may carry', () => {
    expect(
      hasVisibleContent([
        { type: 'reasoning', text: '', reasoning: 'because' } as Part
      ])
    ).toBe(true);
  });

  it('does not count blank text, a tool still running, or one that failed', () => {
    expect(hasVisibleContent([{ type: 'text', text: '  ' }])).toBe(false);
    expect(hasVisibleContent([{ type: 'step-start' }, running('a')])).toBe(
      false
    );
    expect(
      hasVisibleContent([
        { ...done, output: { status: 'error', message: 'no' } },
        {
          type: 'tool-web_search',
          toolCallId: 'e',
          state: 'output-error',
          input: {},
          errorText: 'x'
        } as Part
      ])
    ).toBe(false);
  });
});

describe('markStopped', () => {
  it('closes the calls still running and notes a reply that showed nothing', () => {
    const parts = markStopped([
      { type: 'step-start' },
      running('a'),
      running('b')
    ]);
    expect(
      parts.map(part => ('state' in part ? part.state : part.type))
    ).toEqual(['step-start', 'output-error', 'output-error', 'data-error']);
    expect(parts[parts.length - 1]).toEqual({
      type: 'data-error',
      data: { kind: 'incomplete', message: 'This response was stopped.' }
    });
    expect(hasVisibleContent(parts)).toBe(true);
  });

  it('leaves a reply that had shown something without the note', () => {
    const parts = markStopped([
      { type: 'text', text: 'Node 26 is' },
      running('a')
    ]);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ state: 'output-error' });
  });

  it('leaves a finished reply alone', () => {
    const parts: Part[] = [{ type: 'text', text: 'done' }, done];
    expect(markStopped(parts)).toEqual(parts);
  });
});
