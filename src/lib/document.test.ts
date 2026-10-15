import { describe, expect, it } from 'vitest';

import { type ChatMessage } from '@/types';

import {
  attachmentNames,
  documentForModel,
  documentMediaTypeOf,
  expandDocuments,
  readsPdf
} from './document';

const STORE =
  'https://store.public.blob.vercel-storage.com/uploads/attachments/u1';
const file = (name: string | undefined, mediaType: string, url: string) => ({
  type: 'file' as const,
  mediaType,
  url: `${STORE}/${url}`,
  ...(name && { filename: name })
});
const user = (...parts: ChatMessage['parts']): ChatMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  parts
});

describe('documentMediaTypeOf', () => {
  it('takes the type from the extension, whatever the browser said', () => {
    expect(documentMediaTypeOf('notes.MD')).toBe('text/markdown');
    expect(documentMediaTypeOf('sales.csv')).toBe('text/csv');
    expect(documentMediaTypeOf('report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });

  it('is null for a file that is not a document', () => {
    expect(documentMediaTypeOf('photo.png')).toBeNull();
    expect(documentMediaTypeOf('README')).toBeNull();
  });
});

describe('readsPdf', () => {
  it('is true for the providers that read a PDF themselves, and no others', () => {
    for (const type of [
      'anthropic',
      'google',
      'vertex',
      'openai',
      'azure',
      'xai'
    ] as const) {
      expect(readsPdf(type)).toBe(true);
    }
    expect(readsPdf('deepseek')).toBe(false);
    expect(readsPdf('bedrock')).toBe(false);
  });
});

describe('attachmentNames', () => {
  it('names each file as it was uploaded, numbering a name already taken', () => {
    const names = attachmentNames([
      user(file('data.csv', 'text/csv', 'a.csv')),
      user(
        file('data.csv', 'text/csv', 'b.csv'),
        file('data.csv', 'text/csv', 'c.csv')
      )
    ]);
    expect([...names.values()]).toEqual([
      'data.csv',
      'data (2).csv',
      'data (3).csv'
    ]);
  });

  it('keeps one name for a file attached twice', () => {
    const names = attachmentNames([
      user(file('data.csv', 'text/csv', 'a.csv')),
      user(file('data.csv', 'text/csv', 'a.csv'))
    ]);
    expect([...names.values()]).toEqual(['data.csv']);
  });

  it('falls back to the file’s address, and reads only what the user sent', () => {
    const names = attachmentNames([
      user(file(undefined, 'image/png', 'shot.png')),
      {
        id: 'a',
        role: 'assistant',
        parts: [file('made.png', 'image/png', 'made.png')]
      }
    ]);
    expect([...names.values()]).toEqual(['shot.png']);
  });
});

// A text file, as read: in UTF-8 unless it says otherwise.
const read = (text: string, encoding: string | null = 'utf-8') => ({
  text,
  encoding
});

describe('documentForModel', () => {
  it('gives a table under its name, with how an artifact parses the file', () => {
    expect(documentForModel('a.csv', 'text/csv', read('x,y\n1,2'))).toBe(
      '<document name="a.csv">\nx,y\n1,2\n</document>\n' +
        `[An artifact made from a.csv reads the file itself, rather than copying its data into the code: Papa.parse(await window.fs.readFile("a.csv", { encoding: 'utf8' })), with papaparse.]`
    );
    expect(
      documentForModel(
        'b.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        read('## Sheet1\nx', null)
      )
    ).toContain('XLSX.read(await window.fs.readFile("b.xlsx"))');
  });

  it('has an artifact read a text file in the encoding it was written in', () => {
    expect(
      documentForModel('gbk.csv', 'text/csv', read('产品,一月', 'gb18030'))
    ).toContain(`window.fs.readFile("gbk.csv", { encoding: 'gb18030' })`);
  });

  it('says nothing of reading a PDF or a Word document, which an artifact could not parse', () => {
    expect(
      documentForModel('r.pdf', 'application/pdf', read('PDF TEXT', null))
    ).toBe('<document name="r.pdf">\nPDF TEXT\n</document>');
  });

  it('says when a document could not be read, or held no text', () => {
    expect(documentForModel('a.pdf', 'application/pdf', undefined)).toContain(
      'could not be read'
    );
    expect(
      documentForModel('scan.pdf', 'application/pdf', read(' \n', null))
    ).toContain('No text could be read');
  });

  it('cuts a document to what the model can be given, and says so', () => {
    const text = documentForModel(
      'long.txt',
      'text/plain',
      read('abcd'.repeat(10)),
      3
    );
    expect(text).toContain('\nabcdabcdabcd\n</document>');
    expect(text).toContain('Only the beginning of long.txt is above');
    expect(text).toContain('await window.fs.readFile("long.txt"');
  });

  it('counts other scripts one character a token when it cuts', () => {
    expect(
      documentForModel('cn.txt', 'text/plain', read('一二三四五'), 2)
    ).toContain('\n一二\n</document>');
  });
});

describe('expandDocuments', () => {
  const pdf = file('report.pdf', 'application/pdf', 'r.pdf');
  const csv = file('sales.csv', 'text/csv', 's.csv');
  const image = file('photo.png', 'image/png', 'p.png');
  const messages = [user({ type: 'text', text: 'look' }, pdf, csv, image)];
  const documents = new Map([
    [pdf.url, read('PDF TEXT', null)],
    [csv.url, read('a,b')]
  ]);
  const names = attachmentNames(messages);
  const csvForModel = documentForModel('sales.csv', 'text/csv', read('a,b'));

  it('gives a PDF itself, with its name, to a model whose providers read one', () => {
    const [message] = expandDocuments(messages, {
      documents,
      names,
      nativePdf: true
    });
    expect(message.parts).toEqual([
      { type: 'text', text: 'look' },
      pdf,
      { type: 'text', text: '[PDF attached: report.pdf]' },
      { type: 'text', text: csvForModel },
      image
    ]);
  });

  it('gives a PDF as its text otherwise, and leaves other files alone', () => {
    const [message] = expandDocuments(messages, {
      documents,
      names,
      nativePdf: false
    });
    expect(message.parts).toEqual([
      { type: 'text', text: 'look' },
      {
        type: 'text',
        text: documentForModel(
          'report.pdf',
          'application/pdf',
          read('PDF TEXT', null)
        )
      },
      { type: 'text', text: csvForModel },
      image
    ]);
  });
});
