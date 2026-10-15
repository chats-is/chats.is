import { readFileSync } from 'node:fs';
import { makeTestDb } from '@/test-utils/pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import * as XLSX from 'xlsx';

import { type ChatMessage } from '@/types';
import { DOCUMENT_MEDIA_TYPES } from '@/lib/constant';
import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({
  db: undefined as any,
  env: { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store_secret' }
}));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: h.env }));

const { extractDocumentText, readDocuments } = await import('./document');

/** A one-page PDF whose only text is `text`, written out by hand. */
function pdfOf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function workbook(): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['月份', '销量'],
      ['一月', 120]
    ]),
    '销售'
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['城市'], ['上海']]),
    '门店'
  );
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

describe('extractDocumentText', () => {
  it('reads the text of a PDF', async () => {
    const { text, encoding } = await extractDocumentText(
      pdfOf('The code is PINEAPPLE-4729.'),
      DOCUMENT_MEDIA_TYPES.pdf
    );
    expect(text).toContain('The code is PINEAPPLE-4729.');
    expect(encoding).toBeNull();
  });

  it('reads a Word document as Markdown, its first table row the heading', async () => {
    const { text: markdown } = await extractDocumentText(
      new Uint8Array(readFileSync('src/test-utils/fixtures/report.docx')),
      DOCUMENT_MEDIA_TYPES.docx
    );
    expect(markdown).toContain('# 季度报告 Q3');
    expect(markdown).toContain('**18%**');
    expect(markdown).toContain('-   新增客户 120 家');
    expect(markdown).toMatch(
      /\| 地区\s+\| 营收\s+\| 增长\s+\|\n\| --- \| --- \| --- \|/
    );
  });

  it('reads each sheet of a workbook as CSV under its name', async () => {
    expect(
      await extractDocumentText(workbook(), DOCUMENT_MEDIA_TYPES.xlsx)
    ).toEqual({
      text: '## 销售\n月份,销量\n一月,120\n\n## 门店\n城市\n上海',
      encoding: null
    });
  });

  it('reads a text file as it is', async () => {
    expect(
      await extractDocumentText(
        new TextEncoder().encode('a,b\n1,2'),
        DOCUMENT_MEDIA_TYPES.csv
      )
    ).toEqual({ text: 'a,b\n1,2', encoding: 'utf-8' });
  });

  // CSVs as Excel saves them on a Chinese, a Japanese and a Western Windows.
  it.each([
    [
      'GBK',
      'b2fac6b72cd2bbd4c20ac0b6ddaebdb42c3331310a',
      'gb18030',
      '产品,一月\n蓝莓酱,311\n'
    ],
    [
      'Shift_JIS',
      '90bb95692c88ea8c8e0a8375838b815b8378838a815b2c3331310a',
      'shift_jis',
      '製品,一月\nブルーベリー,311\n'
    ],
    [
      'Windows-1252',
      '50726f647569742cc974e90a4372e86d65206272fb6ce9652c3331310a',
      'windows-1252',
      'Produit,Été\nCrème brûlée,311\n'
    ]
  ])(
    'reads a text file written in %s, and says so',
    async (_, hex, encoding, text) => {
      expect(
        await extractDocumentText(
          new Uint8Array(Buffer.from(hex, 'hex')),
          DOCUMENT_MEDIA_TYPES.csv
        )
      ).toEqual({ text, encoding });
    }
  );
});

describe('readDocuments', () => {
  const USER = 'user-1';
  const STORE = 'https://store.public.blob.vercel-storage.com';
  const mine = (name: string) => `${STORE}/uploads/attachments/${USER}/${name}`;
  const attached = (url: string, mediaType: string): ChatMessage => ({
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'file', mediaType, url }]
  });

  const served = new Map<string, Uint8Array>();
  const fetch = vi.fn(async (url: string) =>
    served.has(url)
      ? new Response(served.get(url) as BodyInit)
      : new Response('gone', { status: 404 })
  );
  let client: { close?: () => Promise<void> } | undefined;

  beforeAll(async () => {
    const t = await makeTestDb();
    h.db = t.db;
    client = t.client;
    vi.stubGlobal('fetch', fetch);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await client?.close?.();
  });

  beforeEach(async () => {
    fetch.mockClear();
    served.clear();
    await h.db.delete(schema.documents);
    await h.db.delete(schema.users);
    await h.db
      .insert(schema.users)
      .values({ id: USER, name: 'A', email: 'a@example.com' });
  });

  it('reads a document once, and looks it up after that', async () => {
    served.set(mine('a.csv'), new TextEncoder().encode('x,y'));
    const messages = [attached(mine('a.csv'), DOCUMENT_MEDIA_TYPES.csv)];

    const read = new Map([[mine('a.csv'), { text: 'x,y', encoding: 'utf-8' }]]);
    expect(await readDocuments(USER, messages)).toEqual(read);
    expect(await readDocuments(USER, messages)).toEqual(read);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps one row for a file two replies read at once', async () => {
    served.set(mine('b.csv'), new TextEncoder().encode('x,y'));
    const messages = [attached(mine('b.csv'), DOCUMENT_MEDIA_TYPES.csv)];

    await Promise.all([
      readDocuments(USER, messages),
      readDocuments(USER, messages)
    ]);

    expect(await h.db.select().from(schema.documents)).toHaveLength(1);
  });

  it('reads only the user’s own uploads, and only documents', async () => {
    const theirs = `${STORE}/uploads/attachments/user-2/b.csv`;
    served.set(theirs, new TextEncoder().encode('no'));
    served.set(mine('p.png'), new TextEncoder().encode('png'));

    expect(
      await readDocuments(USER, [
        attached(theirs, DOCUMENT_MEDIA_TYPES.csv),
        attached(mine('p.png'), 'image/png')
      ])
    ).toEqual(new Map());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves out a document it cannot fetch, and asks again next time', async () => {
    const messages = [attached(mine('gone.pdf'), DOCUMENT_MEDIA_TYPES.pdf)];

    expect(await readDocuments(USER, messages)).toEqual(new Map());
    expect(await readDocuments(USER, messages)).toEqual(new Map());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a document that holds no text, as empty', async () => {
    served.set(mine('blank.txt'), new Uint8Array());

    expect(
      await readDocuments(USER, [
        attached(mine('blank.txt'), DOCUMENT_MEDIA_TYPES.txt)
      ])
    ).toEqual(new Map([[mine('blank.txt'), { text: '', encoding: 'utf-8' }]]));
  });
});
