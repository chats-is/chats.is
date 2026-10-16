import { type ChatMessage } from '@/types';
import { MEDIA_TOOL_NAMES, STOPPED_CALL_ERROR } from '@/lib/constant';

type Part = ChatMessage['parts'][number];

/** The tools whose finished result is drawn in the thread: media, and a
 *  search. An artifact is drawn from its own table, and a transcript is
 *  written out by the model, so neither counts on its own. */
const DRAWN_TOOLS = new Set<string>(
  [...MEDIA_TOOL_NAMES, 'web_search'].map(name => `tool-${name}`)
);

/**
 * Whether a reply has anything to show: words, a file, a finished tool
 * result, or the note that nothing came back. A reply with none of these is
 * not drawn at all, so anything that leaves one that way has to add one.
 */
export function hasVisibleContent(parts: Part[]): boolean {
  return parts.some(part => {
    if (part.type === 'text') {
      return part.text.trim().length > 0 || part.state === 'streaming';
    }
    if (part.type === 'reasoning') {
      // Older rows carry the text under `reasoning`, as the renderer knows.
      const text = part.text || (part as { reasoning?: string }).reasoning;
      return !!text?.trim();
    }
    // A refused turn's only part — and a stopped turn's, below.
    if (part.type === 'data-error') return true;
    if (part.type === 'file') return true;
    // A tool whose result is drawn, and that finished. One that failed is
    // not drawn: the model says what went wrong, in its text.
    if (DRAWN_TOOLS.has(part.type) && 'state' in part) {
      return (
        part.state === 'output-available' &&
        !(
          part.output &&
          typeof part.output === 'object' &&
          'status' in part.output &&
          part.output.status === 'error'
        )
      );
    }
    return false;
  });
}

/**
 * A reply as it stands once it has been stopped.
 *
 * A tool that was still running is left mid-call, and a call without a
 * result is a spinner that never stops — so each is closed as failed, with
 * the reason. And a reply stopped before it had shown anything gets the
 * note a failed one gets: without it the message is dropped as empty, and
 * the user is left with a question and no sign it was ever answered.
 */
export function markStopped(parts: Part[]): Part[] {
  const closed = parts.map((part): Part => {
    if (
      part.type.startsWith('tool-') &&
      'state' in part &&
      (part.state === 'input-streaming' || part.state === 'input-available')
    ) {
      return {
        ...part,
        state: 'output-error',
        errorText: STOPPED_CALL_ERROR
      } as Part;
    }
    return part;
  });

  if (hasVisibleContent(closed)) return closed;
  return [
    ...closed,
    {
      type: 'data-error',
      data: { kind: 'incomplete', message: 'This response was stopped.' }
    }
  ];
}

/** What a provider keeps of a reply on its side, named in its parts. */
const PROVIDER_ITEM_KEYS = ['itemId', 'reasoningEncryptedContent'];

const withoutItems = (metadata: unknown) => {
  if (!metadata || typeof metadata !== 'object') return metadata;
  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).map(
      ([provider, value]) => [
        provider,
        value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value).filter(
                ([key]) => !PROVIDER_ITEM_KEYS.includes(key)
              )
            )
          : value
      ]
    )
  );
};

/**
 * A reply that did not finish — stopped, or cut off — without what it names
 * of the provider's own copy of it.
 *
 * OpenAI keeps each item of a reply it gave, and the next turn sends an item
 * by its id rather than whole: a thought, a message, a tool call. A reply
 * that never finished was never kept, so every turn after it was refused,
 * the item "not found". Without the ids its text and calls are sent whole,
 * and its unfinished thinking, which was never more than started, is left
 * out; the thinking still shows in the thread.
 */
export function forgetProviderItems(parts: Part[]): Part[] {
  return parts.map(part => {
    const named = part as Part & {
      providerMetadata?: unknown;
      callProviderMetadata?: unknown;
    };
    if (!named.providerMetadata && !named.callProviderMetadata) return part;
    return {
      ...part,
      ...(named.providerMetadata
        ? { providerMetadata: withoutItems(named.providerMetadata) }
        : {}),
      ...(named.callProviderMetadata
        ? { callProviderMetadata: withoutItems(named.callProviderMetadata) }
        : {})
    } as Part;
  });
}

/**
 * A reply's writing as it reads, keyed by the part each piece begins at.
 * Text parts next to each other are one piece: Anthropic cuts a cited answer
 * into a block per citation, so "今日" "国际金价约为…" "，" arrive as parts of
 * their own, and drawn one by one each took a line. A source between them
 * draws nothing, and does not part them; anything else — a tool call, a step,
 * a thought — does. A text part that continues a piece has no entry.
 */
export function textRuns(
  parts: Part[]
): Map<number, { text: string; streaming: boolean }> {
  const runs = new Map<number, { text: string; streaming: boolean }>();
  let open: { text: string; streaming: boolean } | null = null;
  parts.forEach((part, index) => {
    if (part.type === 'text') {
      if (open) {
        open.text += part.text;
        open.streaming = part.state === 'streaming';
      } else {
        open = { text: part.text, streaming: part.state === 'streaming' };
        runs.set(index, open);
      }
      return;
    }
    if (part.type !== 'source-url' && part.type !== 'source-document') {
      open = null;
    }
  });
  return runs;
}
