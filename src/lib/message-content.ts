import { mediaToolNames, type ChatMessage } from '@/types';

type Part = ChatMessage['parts'][number];

/** The tools whose finished result is drawn in the thread: media, and a
 *  search. An artifact is drawn from its own table, and a transcript is
 *  written out by the model, so neither counts on its own. */
const DRAWN_TOOLS = new Set<string>(
  [...mediaToolNames, 'web_search'].map(name => `tool-${name}`)
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
        errorText: 'Stopped before it finished.'
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
