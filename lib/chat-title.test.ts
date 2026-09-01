import { describe, expect, it } from 'vitest';

import { ChatMessage } from '@/types';

import { sanitizeTitle, TITLE_MAX, titleInputFromMessage } from './chat-title';

const message = (parts: ChatMessage['parts']): ChatMessage =>
  ({ id: 'm1', role: 'user', parts }) as ChatMessage;

describe('titleInputFromMessage', () => {
  it('hands over what the user wrote, not the message shape', () => {
    const input = titleInputFromMessage(
      message([{ type: 'text', text: 'Summarise this paper for me' }])
    );

    // Fenced: the message is material to name, not something said to the model.
    expect(input).toContain('Summarise this paper for me');
    expect(input.startsWith('Message to name:')).toBe(true);
  });

  it('reduces an attachment to a word for what it is', () => {
    // The URL is what sent the title model looking for tools to call.
    const input = titleInputFromMessage(
      message([
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'https://store.public.blob.vercel-storage.com/uploads/a.png'
        },
        { type: 'text', text: 'make the square green' }
      ])
    );

    expect(input).toContain('[image attachment]\nmake the square green');
    expect(input).not.toContain('blob.vercel-storage');
  });

  it('names each kind of attachment', () => {
    const kinds = ['audio/mpeg', 'video/mp4', 'application/pdf'].map(
      mediaType =>
        titleInputFromMessage(
          message([{ type: 'file', mediaType, url: 'https://x/y' }])
        )
    );

    expect(kinds.map(k => k.split('\n')[2])).toEqual([
      '[audio attachment]',
      '[video attachment]',
      '[file attachment]'
    ]);
  });

  it('is empty when there is nothing to summarise', () => {
    expect(titleInputFromMessage(message([]))).toBe('');
    expect(titleInputFromMessage(message([{ type: 'text', text: '  ' }]))).toBe(
      ''
    );
  });
});

describe('sanitizeTitle', () => {
  it('keeps an ordinary title as it is', () => {
    expect(sanitizeTitle('Red apple on white table')).toBe(
      'Red apple on white table'
    );
  });

  it('cuts at a tool call the model started writing', () => {
    // Verbatim from a chat whose first message carried an image: the model
    // answered the request and then reached for a tool, all of it landing in
    // the title.
    expect(
      sanitizeTitle(
        'I\'ll edit the image for you. <｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="exec_command">'
      )
    ).toBe("I'll edit the image for you.");

    expect(sanitizeTitle('<｜｜DSML｜｜tool_calls> fetch_web_page')).toBe('');
    expect(sanitizeTitle('Look <invoke name="x">')).toBe('Look');
  });

  it('collapses whitespace and strips wrapping quotes', () => {
    expect(sanitizeTitle('  Two\n\nlines  ')).toBe('Two lines');
    expect(sanitizeTitle('"Quoted title"')).toBe('Quoted title');
    expect(sanitizeTitle('「引号标题」')).toBe('引号标题');
  });

  it('clamps to what the column accepts', () => {
    const long = sanitizeTitle('a'.repeat(TITLE_MAX + 50));
    expect(long).toHaveLength(TITLE_MAX);
  });

  it('returns empty for a model that said nothing usable', () => {
    expect(sanitizeTitle('   ')).toBe('');
  });
});
