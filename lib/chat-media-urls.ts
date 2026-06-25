import { ChatMessage } from '@/types';

/**
 * Hosts the media tools are allowed to fetch from. Everything the app stores
 * (generations and uploads) lives in Vercel Blob; restricting fetches to it
 * blocks SSRF via attacker-supplied file parts in user messages (parts are
 * persisted verbatim from the request body, so the conversation allow-list
 * alone is not a trust boundary).
 */
export function isTrustedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.endsWith('.public.blob.vercel-storage.com')
    );
  } catch {
    return false;
  }
}

/**
 * Replace file parts the chat model can't consume with a text marker carrying
 * the URL, before the conversation is converted to model messages:
 *   - audio/video: no chat provider accepts them as message content
 *   - images: only when the model lacks vision support
 * The marker keeps the model aware of the attachment so it can reference it
 * via the media tools (transcribe_audio / edit_image). Persistence is
 * unaffected — this only shapes what the model sees.
 */
export function maskUnsupportedFileParts(
  messages: ChatMessage[],
  options: { supportsVision?: boolean | null }
): ChatMessage[] {
  return messages.map(message => ({
    ...message,
    parts: (message.parts ?? []).map(part => {
      if (part.type !== 'file') return part;
      const mediaType = part.mediaType ?? '';
      if (mediaType.startsWith('audio/')) {
        return {
          type: 'text' as const,
          text: `[Audio file attached: ${part.url}]`
        };
      }
      if (mediaType.startsWith('video/')) {
        return {
          type: 'text' as const,
          text: `[Video file attached: ${part.url}]`
        };
      }
      if (mediaType.startsWith('image/') && !options.supportsVision) {
        return {
          type: 'text' as const,
          text: `[Image file attached: ${part.url}]`
        };
      }
      return part;
    })
  }));
}

/**
 * Collect every media URL present in the conversation: file parts (user
 * uploads and persisted generations) plus successful media tool outputs.
 * Used to allow-list `edit_image` / `transcribe_audio` inputs — the model may
 * only reference media that actually exists in this chat (combined with
 * `isTrustedMediaUrl` as the storage-origin trust boundary).
 */
export function collectConversationMediaUrls(
  messages: ChatMessage[]
): Set<string> {
  const urls = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type === 'file' && part.url) {
        urls.add(part.url);
      }
      if (
        part.type.startsWith('tool-') &&
        'output' in part &&
        part.output &&
        typeof part.output === 'object' &&
        'url' in part.output &&
        typeof part.output.url === 'string'
      ) {
        urls.add(part.output.url);
      }
    }
  }
  return urls;
}
