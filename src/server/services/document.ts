import '@tanstack/react-start/server-only';

import { gfm } from '@joplin/turndown-plugin-gfm';
import chardet from 'chardet';
import { and, eq, inArray } from 'drizzle-orm';
import jschardet from 'jschardet';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { extractText, getDocumentProxy } from 'unpdf';
import * as XLSX from 'xlsx';

import { type ChatMessage, type DocumentText } from '@/types';
import { DOCUMENT_MEDIA_TYPES, UPLOAD_CONFIG } from '@/lib/constant';
import { isDocumentMediaType } from '@/lib/document';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { isUsersOwnFile } from '@/server/services/blob';

/**
 * A Word document's tables have a heading row only where its author marked
 * one, and a table without one becomes Markdown with an empty heading above
 * the first row. The first row is nearly always the heading, so it is made
 * one.
 */
const withHeadingRows = (html: string) =>
  html.replace(
    /<table>(\s*)<tr>([\s\S]*?)<\/tr>/g,
    (table, space: string, cells: string) =>
      cells.includes('<th')
        ? table
        : `<table>${space}<tr>${cells
            .replace(/<td(\s|>)/g, '<th$1')
            .replace(/<\/td>/g, '</th>')}</tr>`
  );

/**
 * A text file's encoding, as TextDecoder names it. Most are UTF-8; a CSV
 * saved from Excel on a Chinese Windows is GBK, on a Japanese one Shift_JIS,
 * on a Western one Windows-1252 — and read as UTF-8, any of them is noise.
 * Neither detector is right about every short file: jschardet tells the
 * East Asian encodings apart where chardet does not, chardet the Western
 * ones, and jschardet names some by Windows code page (CP932), which
 * TextDecoder knows under another name, or not at all.
 */
function textEncodingOf(bytes: Uint8Array): string {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {}
  const guesses = [
    jschardet.detect(Buffer.from(bytes)).encoding,
    chardet.detect(bytes)
  ];
  for (const guess of guesses) {
    if (!guess) continue;
    for (const label of [
      guess,
      guess.replace(/^cp(\d+)$/i, 'windows-$1'),
      guess.replace(/^cp(\d+)$/i, 'ms$1')
    ]) {
      try {
        return new TextDecoder(label).encoding;
      } catch {}
    }
  }
  return 'utf-8';
}

/**
 * The text of a document, as a model is to read it: a PDF's text; a Word
 * document as Markdown, its headings, lists and tables kept — as MarkItDown
 * does it, through Mammoth's HTML; each sheet of a workbook as CSV under its
 * name, the fewest tokens a table takes; a text file in the encoding it was
 * written in, which is kept for an artifact to read it in too.
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  mediaType: string
): Promise<DocumentText> {
  switch (mediaType) {
    case DOCUMENT_MEDIA_TYPES.pdf: {
      const { text } = await extractText(await getDocumentProxy(bytes), {
        mergePages: true
      });
      return { text, encoding: null };
    }
    case DOCUMENT_MEDIA_TYPES.docx: {
      const { value } = await mammoth.convertToHtml({
        buffer: Buffer.from(bytes)
      });
      const markdown = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-'
      });
      markdown.use(gfm);
      return {
        text: markdown.turndown(withHeadingRows(value)),
        encoding: null
      };
    }
    case DOCUMENT_MEDIA_TYPES.xlsx:
    case DOCUMENT_MEDIA_TYPES.xls: {
      const workbook = XLSX.read(bytes);
      return {
        text: workbook.SheetNames.map(
          name =>
            `## ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`
        ).join('\n\n'),
        encoding: null
      };
    }
    default: {
      const encoding = textEncodingOf(bytes);
      return { text: new TextDecoder(encoding).decode(bytes), encoding };
    }
  }
}

/** The file at `url`, or null where it is gone or larger than an upload may
 *  be. Only ever a file of this install's own store. */
async function download(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength <= UPLOAD_CONFIG.attachment.maxSize ? bytes : null;
}

/**
 * The text of every document the user attached in `messages`, by its
 * address. Each is read from its file once, the first time a message
 * carrying it is answered, and kept; from then on it is looked up.
 *
 * Only the user's own uploads are read. One that cannot be — gone from
 * storage, or not a file this reads — is left out, and the model is told it
 * could not be read; one read but holding no text, a scanned PDF, is kept
 * empty, and the model is told that.
 */
export async function readDocuments(
  userId: string,
  messages: ChatMessage[]
): Promise<Map<string, DocumentText>> {
  const attached = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const part of message.parts) {
      if (
        part.type === 'file' &&
        isDocumentMediaType(part.mediaType) &&
        isUsersOwnFile(part.url, userId)
      ) {
        attached.set(part.url, part.mediaType);
      }
    }
  }
  if (attached.size === 0) return new Map();

  const kept = await db
    .select({
      url: documents.url,
      text: documents.text,
      encoding: documents.encoding
    })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        inArray(documents.url, [...attached.keys()])
      )
    );
  const texts = new Map<string, DocumentText>(
    kept.map(({ url, text, encoding }) => [url, { text, encoding }])
  );

  const unread = [...attached].filter(([url]) => !texts.has(url));
  const read = await Promise.all(
    unread.map(async ([url, mediaType]) => {
      try {
        const bytes = await download(url);
        if (!bytes) return null;
        return {
          id: generateUUID(),
          url,
          userId,
          mediaType,
          ...(await extractDocumentText(bytes, mediaType))
        };
      } catch (err) {
        console.error(`[document] could not read ${url}:`, err);
        return null;
      }
    })
  );
  const rows = read.filter(row => row !== null);
  if (rows.length > 0) {
    // Two replies to the same chat at once read the same file; whichever
    // writes second keeps the first one's text, which is the same.
    await db
      .insert(documents)
      .values(rows)
      .onConflictDoNothing({ target: documents.url });
    for (const { url, text, encoding } of rows) {
      texts.set(url, { text, encoding });
    }
  }
  return texts;
}
