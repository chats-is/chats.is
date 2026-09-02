import { type ChatMessage } from '@/types';

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
 * Shape the conversation so the chat model can both consume its attachments
 * and refer to them, before it is converted to model messages:
 *   - audio/video become a text marker carrying the URL: no chat provider
 *     accepts them as message content;
 *   - an image the model cannot see becomes the same kind of marker;
 *   - an image it can see keeps its file part and gains the marker alongside.
 *
 * That last case is why the marker is not merely a fallback. A vision model
 * receives the image as content, which shows it the picture but never its URL
 * — and `edit_image` takes a URL. Without the marker the better model was the
 * one that could not edit an upload: it saw the image and then asked the user
 * to attach it again.
 *
 * Persistence is unaffected — this only shapes what the model sees.
 */
export function maskUnsupportedFileParts(
  messages: ChatMessage[],
  options: { supportsVision?: boolean | null }
): ChatMessage[] {
  return messages.map(message => ({
    ...message,
    parts: (message.parts ?? []).flatMap((part): ChatMessage['parts'] => {
      if (part.type !== 'file') return [part];
      const mediaType = part.mediaType ?? '';
      const marker = (label: string) => ({
        type: 'text' as const,
        text: `[${label} file attached: ${part.url}]`
      });

      if (mediaType.startsWith('audio/')) return [marker('Audio')];
      if (mediaType.startsWith('video/')) return [marker('Video')];
      if (mediaType.startsWith('image/')) {
        return options.supportsVision
          ? [part, marker('Image')]
          : [marker('Image')];
      }
      return [part];
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
