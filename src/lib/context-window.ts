import { type ChatMessage } from '@/types';
import { estimateTokens } from '@/lib/token-estimate';

/** What an image costs a model that can see it — flat, whatever its size on
 *  disk. Providers differ; this is the upper end of what they charge. */
const IMAGE_TOKENS = 1500;

function partTokens(part: ChatMessage['parts'][number]): number {
  if (part.type === 'text' || part.type === 'reasoning') {
    return estimateTokens(part.text);
  }
  if (part.type === 'file') {
    return part.mediaType.startsWith('image/')
      ? IMAGE_TOKENS
      : estimateTokens(part.url);
  }
  // A tool call goes to the model as its input and its result, both JSON.
  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    const { input, output } = part as { input?: unknown; output?: unknown };
    return estimateTokens(JSON.stringify([input ?? null, output ?? null]));
  }
  return 0;
}

const messageTokens = (message: ChatMessage) =>
  // A few tokens of framing per message, on every provider.
  message.parts.reduce((sum, part) => sum + partTokens(part), 4);

/**
 * The most recent part of a conversation that fits in `budget` tokens.
 *
 * A chat is sent whole on every turn, so one that is simply used for long
 * enough outgrows its model — and from then on every turn in it is refused by
 * the provider, with nothing the user can do but abandon the chat. Forgetting
 * the beginning is the lesser loss, and it is what is dropped: whole messages,
 * oldest first.
 *
 * Whole, because a message is the unit that stays coherent — an assistant
 * message carries its tool calls together with their results, and half of one
 * is a call with no result. The last message is the one being answered and is
 * always kept, even alone and over budget: there is nothing left to drop, and
 * the provider's own refusal is the honest answer to a message that large. And
 * what is kept begins with the user speaking, which several providers insist
 * on and all of them read better.
 */
export function fitToContext(
  messages: ChatMessage[],
  budget: number
): { messages: ChatMessage[]; dropped: number } {
  let used = 0;
  let start = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    used += messageTokens(messages[i]);
    if (used > budget && i < messages.length - 1) break;
    start = i;
  }

  while (start < messages.length - 1 && messages[start].role !== 'user') {
    start++;
  }

  return { messages: messages.slice(start), dropped: start };
}
