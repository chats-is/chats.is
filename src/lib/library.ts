import {
  mediaToolNames,
  type ChatMessage,
  type MediaToolOutput
} from '@/types';

/** A generated media entry surfaced in the Library, extracted from a
 *  persisted assistant message (file part or media tool output). */
export type LibraryMediaItem = {
  /** Stable key: `${messageId}:${partIndex}`. */
  id: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  mediaType: string;
  /**
   * What the message said when it produced this — the same words that sit
   * beside the media in the chat.
   */
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

  /**
   * What the message says, and only that.
   *
   * Not the prompt the model wrote for the image tool: that is an argument to
   * a tool call, never shown in the chat, and a card titled with it says
   * something the reader has never seen. Not the reasoning either, which the
   * chat keeps folded away under "Thoughts" — a library is not the place it
   * gets unfolded. What is left is the reply the media arrived with.
   */
  const said = (message.parts ?? [])
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
    .trim();

  (message.parts ?? []).forEach((part, index) => {
    let url: string | undefined;
    let mediaType: string | undefined;
    let title: string | undefined;

    if (part.type === 'file' && part.url) {
      url = part.url;
      mediaType = part.mediaType;
      title = said || part.filename;
    } else if (
      MEDIA_TOOL_PART_TYPES.has(part.type) &&
      'output' in part &&
      part.output
    ) {
      const output = part.output as MediaToolOutput;
      if (output.status !== 'done') return;
      url = output.url;
      mediaType = output.mediaType;
      title = said || output.filename;
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
