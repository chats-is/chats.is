import { type ChatMessage } from '@/types';

/** `chat.title` is varchar(255); the router validates the same bound. */
export const TITLE_MAX = 255;

/**
 * What the title model is asked to summarise.
 *
 * The whole message used to be handed over as `JSON.stringify(message)`, which
 * put the parts array and every attachment URL in front of a model whose only
 * job is to name the conversation. Given that, it stopped writing titles and
 * started behaving like an assistant with a task: answering the request in full
 * sentences, or emitting its own tool-call syntax to go and fetch the URL it
 * had just been shown. Whatever it produced became the title.
 *
 * So it gets the text the user actually wrote, with each attachment reduced to
 * a word for what it is. Returns '' when there is nothing to summarise.
 */
export function titleInputFromMessage(message: ChatMessage): string {
  const pieces = (message.parts ?? []).map(part => {
    if (part.type === 'text') return part.text.trim();
    if (part.type !== 'file') return '';

    const mediaType = part.mediaType ?? '';
    if (mediaType.startsWith('image/')) return '[image attachment]';
    if (mediaType.startsWith('audio/')) return '[audio attachment]';
    if (mediaType.startsWith('video/')) return '[video attachment]';
    return '[file attachment]';
  });

  const text = pieces.filter(Boolean).join('\n').trim();
  if (!text) return '';

  // Fenced, so the model reads it as material rather than as something said
  // to it. Left bare, a request like "turn the square green" got answered
  // instead of named, and the reply became the title.
  return ['Message to name:', '"""', text, '"""'].join('\n');
}

/**
 * Markers a model uses to open a tool call in its own syntax — DeepSeek's
 * `<｜｜DSML｜｜tool_calls>` (full-width bars), the `<|...|>` family, and the
 * XML-ish `<invoke>` / `<tool_call>` forms.
 */
const TOOL_CALL_MARKER =
  /<\s*[｜|]|<\s*\/?\s*(invoke|tool_call|function_call)/i;

/**
 * Clean up whatever the title model returned.
 *
 * A title is stored in a varchar(255), and an over-long one used to throw
 * inside `chat.create` — failing the entire chat request, so the user lost the
 * reply they were waiting for over a name. Cutting at the first tool-call
 * marker covers the other half: a model that starts narrating or calling tools
 * has stopped answering the question, and the readable part before it is the
 * closest thing to a title on offer.
 */
export function sanitizeTitle(text: string): string {
  const [readable] = text.split(TOOL_CALL_MARKER);
  return (readable ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”「」]+|["'“”「」]+$/g, '')
    .trim()
    .slice(0, TITLE_MAX)
    .trim();
}
