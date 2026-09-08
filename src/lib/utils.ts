import { v4 as uuidv4 } from 'uuid';

import { type ChatMessage } from '@/types';
import { type DBMessage } from '@/types/message';

/**
 * Re-exported rather than reimplemented: shadcn's components now import `cn`
 * from its own package, and two merge implementations would sooner or later
 * disagree about which of two conflicting classes wins. One function, reached
 * by both names.
 */
export { cn } from 'cn';

export const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (!res.ok) {
    const json = await res.json();
    throw { error: json.error };
  }

  return res.json();
};

export function generateUUID(): string {
  return uuidv4();
}

/**
 * Coerce a value (drizzle `numeric` string, number, or nullish) into a JS
 * number. Returns `null` for null/undefined/empty/non-finite input — callers
 * use `?? 0` when they want a numeric default.
 */
export function parseNumber(
  v: string | number | null | undefined
): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Format a number with locale thousands separators (e.g. 1234 → "1,234"). */
export function formatNumber(n: number): string {
  return Number(n).toLocaleString();
}

/**
 * Format a USD amount preserving full precision (matches the `numeric(20,10)`
 * DB scale) with trailing zeros trimmed, so displayed cost/price always equals
 * the stored value and never silently truncates. Examples:
 *   0.08604231 → "$0.08604231"   12.5 → "$12.5"   0 → "$0"
 */
export function formatUsd(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '$0';
  const trimmed = n.toFixed(10).replace(/\.?0+$/, '');
  return `$${trimmed || '0'}`;
}

/**
 * Start instant of the usage-report window: local 00:00 of `(today - days + 1)`.
 * `days=1` → today 00:00 (local); `days=7` → six days ago 00:00 (local).
 *
 * Runs in the browser, so `new Date(y, m, d)` resolves against the user's local
 * timezone — the returned Date is an absolute instant. Sent to the server as
 * `from` for a pure `createdAt >= from` (timestamptz) comparison, so the KPI
 * window and the local-day chart buckets cover exactly the same N calendar days.
 */
export function reportWindowStart(days: number): Date {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (days - 1)
  );
}

/**
 * Fill `{name}` placeholders from `args`.
 *
 * One pass, not one pass per name: replacing in turn lets an earlier value
 * that happens to contain `{something}` be replaced again by a later one, and
 * some of these values come from the browser. A name with no entry is left as
 * it stands, so a stray brace reads as itself rather than vanishing.
 */
export function formatString(
  formatString: string,
  args: Record<string, any>
): string {
  return formatString.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in args ? String(args[name] ?? '') : whole
  );
}

/**
 * The current moment, told in `timeZone` when the browser named one.
 *
 * The server's clock decides *when*; the browser only decides *where* — a
 * timestamp taken from the client would carry that machine's clock error into
 * the prompt, and UTC would put "today" a day out for much of the world.
 *
 * The weekday is there because "what day is it" is asked more often than the
 * date; the zone because an hour without one is worth little; and no seconds,
 * which nothing in a conversation turns on. 24-hour, so there is no am/pm to
 * misread.
 */
export function formatLocalTime(timeZone?: string | null): string {
  const now = new Date();
  if (!timeZone) return now.toISOString();
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    }).format(now);
  } catch {
    // An unknown zone throws rather than falling back, and a prompt is not
    // worth failing a chat over.
    return now.toISOString();
  }
}

export function getMostRecentUserMessage(messages: ChatMessage[]) {
  const userMessage = messages
    .filter(message => message.role === 'user')
    .at(-1);
  return userMessage;
}

/** Audio models cover both directions; `supportsTranscription` marks STT. */
/**
 * Does `modelId` name this model?
 *
 * A model answers to its `modelId` and to any admin-configured alias — aliases
 * exist so ids stored on older chats keep resolving. The server does this in
 * `findModelByModelId`, so anything client-side deciding whether a model is
 * "selected" has to match, or the two disagree about the same chat.
 */
export function modelMatchesId(
  model: { modelId: string; aliases?: string[] | null },
  modelId: string | null | undefined
): boolean {
  if (!modelId) return false;
  return model.modelId === modelId || !!model.aliases?.includes(modelId);
}

export function isSttModel(model: {
  capability: string;
  supportsTranscription?: boolean | null;
}): boolean {
  return model.capability === 'audio' && !!model.supportsTranscription;
}

export function isTtsModel(model: {
  capability: string;
  supportsTranscription?: boolean | null;
}): boolean {
  return model.capability === 'audio' && !model.supportsTranscription;
}

/** Format seconds as m:ss for media players; 0:00 for unknown durations. */
export function formatMediaTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return '0:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function convertToChatMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map(message => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: {
      parentId: message.parentId,
      reasonDuration: message.reasonDuration ?? undefined,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt
    }
  }));
}
