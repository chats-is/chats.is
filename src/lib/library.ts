import { ChatMessage, mediaToolNames, MediaToolOutput } from '@/types';

/** A generated media entry surfaced in the Library, extracted from a
 *  persisted assistant message (file part or media tool output). */
export type LibraryMediaItem = {
  /** Stable key: `${messageId}:${partIndex}`. */
  id: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  mediaType: string;
  /** Generation prompt (media tools) or filename (legacy file parts). */
  title?: string;
  chatId: string | null;
  messageId: string;
  createdAt: Date;
};

// Derived from the canonical tool list so a newly added media tool can't be
// silently missing from the Library.
const MEDIA_TOOL_PART_TYPES = new Set<string>(
  mediaToolNames.map(name => `tool-${name}`)
);

function kindFromMediaType(mediaType: string): LibraryMediaItem['kind'] | null {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('audio/')) return 'audio';
  return null;
}

/**
 * Extract the generated media of one assistant message: media tool outputs
 * (chat tools) plus file parts (legacy standalone generations). The Library
 * reads straight from persisted messages — no separate media table.
 */
export function extractLibraryMedia(message: {
  id: string;
  chatId: string | null;
  parts: ChatMessage['parts'];
  createdAt: Date;
}): LibraryMediaItem[] {
  const items: LibraryMediaItem[] = [];

  (message.parts ?? []).forEach((part, index) => {
    let url: string | undefined;
    let mediaType: string | undefined;
    let title: string | undefined;

    if (part.type === 'file' && part.url) {
      url = part.url;
      mediaType = part.mediaType;
      title = part.filename;
    } else if (
      MEDIA_TOOL_PART_TYPES.has(part.type) &&
      'output' in part &&
      part.output
    ) {
      const output = part.output as MediaToolOutput;
      if (output.status !== 'done') return;
      url = output.url;
      mediaType = output.mediaType;
      const input =
        'input' in part
          ? (part.input as { prompt?: string; text?: string } | undefined)
          : undefined;
      title = input?.prompt ?? input?.text ?? output.filename;
    }

    if (!url || !mediaType) return;
    const kind = kindFromMediaType(mediaType);
    if (!kind) return;

    items.push({
      id: `${message.id}:${index}`,
      kind,
      url,
      mediaType,
      title,
      chatId: message.chatId,
      messageId: message.id,
      createdAt: message.createdAt
    });
  });

  return items;
}
