import { tool } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type ChatMessage } from '@/types';

import {
  forgetProviderItems,
  hasVisibleContent,
  markStopped,
  textRuns,
  withoutRefusedCalls
} from './message-content';

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
          input: { title: 't', type: 'text', content: 'c' },
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

describe('forgetProviderItems', () => {
  it('leaves out what names the provider’s own copy, and keeps the rest', () => {
    const parts = [
      {
        type: 'reasoning',
        text: '',
        state: 'done',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc' }
        }
      },
      {
        type: 'text',
        text: 'Hi',
        state: 'done',
        providerMetadata: { openai: { itemId: 'msg_1', phase: 'final' } }
      },
      {
        type: 'tool-create_artifact',
        toolCallId: 'call_1',
        state: 'output-error',
        input: {},
        errorText: 'Stopped before it finished.',
        callProviderMetadata: { openai: { itemId: 'fc_1' } }
      },
      { type: 'step-start' }
    ] as unknown as ChatMessage['parts'];

    expect(forgetProviderItems(parts)).toEqual([
      {
        type: 'reasoning',
        text: '',
        state: 'done',
        providerMetadata: { openai: {} }
      },
      {
        type: 'text',
        text: 'Hi',
        state: 'done',
        providerMetadata: { openai: { phase: 'final' } }
      },
      {
        type: 'tool-create_artifact',
        toolCallId: 'call_1',
        state: 'output-error',
        input: {},
        errorText: 'Stopped before it finished.',
        callProviderMetadata: { openai: {} }
      },
      { type: 'step-start' }
    ]);
  });
});

describe('withoutRefusedCalls', () => {
  const tools = {
    create_artifact: tool({
      inputSchema: z.object({ title: z.string(), content: z.string() })
    })
  };
  const call = (
    id: string,
    input: unknown,
    state: 'output-error' | 'output-available' = 'output-error'
  ): Part =>
    ({
      type: 'tool-create_artifact',
      toolCallId: id,
      state,
      input,
      ...(state === 'output-error'
        ? { errorText: 'failed' }
        : { output: { id: 'a1' } })
    }) as Part;

  it('leaves out a call whose input its tool refused', async () => {
    const refused = call('c1', { title: 'Game' });
    const again = call('c2', { title: 'Game' });
    const made = call(
      'c3',
      { title: 'Game', content: 'x' },
      'output-available'
    );
    const text: Part = { type: 'text', text: 'Here it is.' };

    expect(
      await withoutRefusedCalls([refused, again, made, text], tools)
    ).toEqual([made, text]);
  });

  it('keeps a call that ran and failed, and one to a tool not on offer', async () => {
    const ranAndFailed = call('c1', { title: 'Game', content: 'x' });
    const unknown = {
      type: 'tool-generate_image',
      toolCallId: 'c2',
      state: 'output-error',
      input: {},
      errorText: 'failed'
    } as Part;

    expect(await withoutRefusedCalls([ranAndFailed, unknown], tools)).toEqual([
      ranAndFailed,
      unknown
    ]);
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

describe('textRuns', () => {
  const text = (value: string, state: 'done' | 'streaming' = 'done'): Part => ({
    type: 'text',
    text: value,
    state
  });
  const source = (url: string): Part => ({
    type: 'source-url',
    sourceId: url,
    url
  });

  it('joins the blocks a cited answer is cut into, across its sources', () => {
    const runs = textRuns([
      { type: 'step-start' },
      text('今日'),
      text('国际金价约为 **$4,138**'),
      source('https://a.com'),
      text('，'),
      text('汇率约为 6.69', 'streaming')
    ]);
    expect([...runs]).toEqual([
      [
        1,
        { text: '今日国际金价约为 **$4,138**，汇率约为 6.69', streaming: true }
      ]
    ]);
  });

  it('keeps writing on either side of anything else apart', () => {
    const runs = textRuns([
      text('Searching.'),
      running('s1'),
      { type: 'step-start' },
      text('Found it.')
    ]);
    expect([...runs]).toEqual([
      [0, { text: 'Searching.', streaming: false }],
      [3, { text: 'Found it.', streaming: false }]
    ]);
  });
});
