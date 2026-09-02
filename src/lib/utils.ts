import { UIMessagePart } from 'ai';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

import { ChatMessage, ChatTools, CustomUIDataTypes, Result } from '@/types';
import { DBMessage } from '@/types/message';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (!res.ok) {
    const json = await res.json();
    throw { error: json.error } as Result;
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

export function formatString(
  formatString: string,
  args: Record<string, any>
): string {
  let formattedString = formatString;

  for (const name in args) {
    const placeholder = `{${name}}`;
    const value = args[name];

    formattedString = formattedString.replaceAll(placeholder, value);
  }

  return formattedString;
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
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      parentId: message.parentId,
      reasonDuration: message.reasonDuration ?? undefined,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt
    }
  }));
}
