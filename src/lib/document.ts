import {
  type ArtifactFile,
  type ChatMessage,
  type DocumentText,
  type ProviderType
} from '@/types';
import { DOCUMENT_MEDIA_TYPES } from '@/lib/constant';
import { cutToTokens } from '@/lib/token-estimate';

const DOCUMENT_TYPES = new Set<string>(Object.values(DOCUMENT_MEDIA_TYPES));

/** The type a document is stored under, from its file name; null for a file
 *  that is not one. */
export function documentMediaTypeOf(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return extension in DOCUMENT_MEDIA_TYPES
    ? DOCUMENT_MEDIA_TYPES[extension as keyof typeof DOCUMENT_MEDIA_TYPES]
    : null;
}

export function isDocumentMediaType(mediaType: string): boolean {
  return DOCUMENT_TYPES.has(mediaType);
}

/**
 * Whether a provider's API reads a PDF itself — its text, and its pages as
 * pictures — for a model that can see. Each was tried with one, or its own
 * documentation says so. DeepSeek's reads none, and Bedrock's Converse API
 * only takes the text out, which the document's own text already gives.
 */
export function readsPdf(type: ProviderType): boolean {
  switch (type) {
    case 'anthropic':
    case 'google':
    case 'vertex':
    case 'openai':
    case 'azure':
    case 'xai':
      return true;
    default:
      return false;
  }
}

/**
 * The name each file a user attached goes by in a chat, by its address: the
 * name it was uploaded with, numbered when a file before it had the same
 * one. The model is told these names, and an artifact reads a file by one.
 */
export function attachmentNames(messages: ChatMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const part of message.parts) {
      if (part.type !== 'file' || names.has(part.url)) continue;
      const name =
        part.filename?.trim() ||
        decodeURIComponent(new URL(part.url).pathname.split('/').pop() ?? '') ||
        'file';
      const dot = name.lastIndexOf('.');
      const [stem, extension] =
        dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let unique = name;
      for (let n = 2; taken.has(unique); n++) {
        unique = `${stem} (${n})${extension}`;
      }
      taken.add(unique);
      names.set(part.url, unique);
    }
  }
  return names;
}

/** The files an artifact in a chat can read: every one the user attached,
 *  under its name in the chat. */
export function artifactFiles(messages: ChatMessage[]): ArtifactFile[] {
  return [...attachmentNames(messages)].map(([url, name]) => ({ name, url }));
}

/**
 * How an artifact reads a document it is made from, for the kinds it can make
 * use of: a table, as the rows it parses itself; a text file, as its text. A
 * PDF or a Word document it could not parse, and has only the text above.
 *
 * Said here, beside the data, and nowhere else: a model told once, among its
 * instructions, copied a file's rows into the code all the same; and those
 * instructions, written into every prompt, left Gemini answering with nothing
 * far more often — in a chat with no file in it too.
 */
function readingNote(
  name: string,
  mediaType: string,
  encoding: string | null
): string | null {
  const file = JSON.stringify(name);
  // The encoding it was written in, which is not always UTF-8.
  const asText = `{ encoding: '${!encoding || encoding === 'utf-8' ? 'utf8' : encoding}' }`;
  const reads = `An artifact made from ${name} reads the file itself, rather than copying its data into the code:`;
  switch (mediaType) {
    case DOCUMENT_MEDIA_TYPES.xlsx:
    case DOCUMENT_MEDIA_TYPES.xls:
      return `${reads} XLSX.read(await window.fs.readFile(${file})), with xlsx.`;
    case DOCUMENT_MEDIA_TYPES.csv:
      return `${reads} Papa.parse(await window.fs.readFile(${file}, ${asText})), with papaparse.`;
    case DOCUMENT_MEDIA_TYPES.json:
    case DOCUMENT_MEDIA_TYPES.txt:
    case DOCUMENT_MEDIA_TYPES.md:
      return `${reads} await window.fs.readFile(${file}, ${asText}).`;
    default:
      return null;
  }
}

/**
 * A document as the model reads it: its text, under its name, and how an
 * artifact reads the file. One the model could not be given whole is cut to
 * `maxTokens`, and says so — the file itself is whole.
 */
export function documentForModel(
  name: string,
  mediaType: string,
  document: DocumentText | undefined,
  maxTokens?: number
): string {
  if (document === undefined) {
    return `<document name="${name}">\n(This document could not be read.)\n</document>`;
  }
  const { text, encoding } = document;
  if (!text.trim()) {
    return `<document name="${name}">\n(No text could be read from this document.)\n</document>`;
  }
  const cut = maxTokens ? cutToTokens(text, maxTokens) : null;
  const notes = [
    cut !== null &&
      `Only the beginning of ${name} is above; the document goes on.`,
    readingNote(name, mediaType, encoding)
  ].filter(Boolean);
  return [
    `<document name="${name}">\n${cut ?? text}\n</document>`,
    ...(notes.length > 0 ? [`[${notes.join(' ')}]`] : [])
  ].join('\n');
}

/**
 * The conversation with each document a user attached put as the model is
 * to have it: a PDF as the file itself, when `nativePdf` says every provider
 * behind the model reads one; anything else as its text. The file a model
 * reads itself keeps a line with its name, which is what an artifact reads
 * it by.
 *
 * Only what the model sees is shaped; the message is stored as it was sent.
 */
export function expandDocuments(
  messages: ChatMessage[],
  options: {
    documents: Map<string, DocumentText>;
    names: Map<string, string>;
    nativePdf: boolean;
    maxTokens?: number;
  }
): ChatMessage[] {
  return messages.map(message => ({
    ...message,
    parts: message.parts.flatMap((part): ChatMessage['parts'] => {
      if (part.type !== 'file' || !isDocumentMediaType(part.mediaType)) {
        return [part];
      }
      const name = options.names.get(part.url) ?? part.filename ?? 'document';
      if (options.nativePdf && part.mediaType === DOCUMENT_MEDIA_TYPES.pdf) {
        return [part, { type: 'text', text: `[PDF attached: ${name}]` }];
      }
      return [
        {
          type: 'text',
          text: documentForModel(
            name,
            part.mediaType,
            options.documents.get(part.url),
            options.maxTokens
          )
        }
      ];
    })
  }));
}
