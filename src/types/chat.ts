import { z } from 'zod';

import { type Artifact } from './artifact';
import { mediaToolsOptionsSchema } from './chat-tools';
import { messageSchema, userMessageSchema, type ChatMessage } from './message';

export const chatTypeSchema = z.enum(['chat', 'audio', 'image', 'video']);
export type ChatType = z.infer<typeof chatTypeSchema>;

export type Chat = {
  id: string;
  title: string;
  type: ChatType;
  modelId: string;
  streamId?: string | null;
  messages: ChatMessage[];
  artifacts?: Artifact[];
  createdAt: Date;
  updatedAt: Date;
};

/**
 * What the chat server functions accept. A chat is created together with the
 * messages that opened it, and thereafter addressed by id.
 */
export const chatCreateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(255),
  type: chatTypeSchema.default('chat'),
  modelId: z.string().trim().min(1).max(255),
  messages: z.array(messageSchema)
});

export const chatUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(255).optional(),
  modelId: z.string().trim().min(1).max(255).optional()
});

export const chatListSchema = z.object({
  type: chatTypeSchema.optional(),
  limit: z.number().min(1).default(50).optional(),
  offset: z.number().min(0).default(0).optional(),
  cursor: z.number().nullish()
});

export const chatDetailSchema = z.object({
  id: z.string().min(1),
  type: chatTypeSchema.optional(),
  includeMessages: z.boolean().default(true),
  includeArtifacts: z.boolean().default(false)
});

export const chatIdSchema = z.object({ id: z.string().min(1) });

/**
 * What `/api/chat` accepts for one turn. The route owns its request, so it is
 * not a server function — but what it is sent is decided here, like the rest.
 */
export const chatRequestSchema = z.object({
  id: z.string().min(1),
  modelId: z.string().trim().min(1).max(255),
  userMessage: userMessageSchema,
  /** Names the user message itself when a reply is being regenerated. */
  parentMessageId: z.string().min(1).optional(),
  isReasoning: z.boolean().optional(),
  effort: z.string().max(64).optional(),
  /** IANA zone from the browser, so "now" can be told in the user's terms. */
  timeZone: z.string().max(64).optional(),
  /** The browser's preferred language, e.g. `zh-CN`. */
  language: z.string().max(64).optional(),
  // Preferences out of the browser's storage, which outlive the versions that
  // wrote them. One that no longer parses is dropped — the server's defaults
  // apply — rather than refusing every turn until the user clears their data.
  mediaOptions: mediaToolsOptionsSchema.optional().catch(undefined),
  /** The user's switch for the media tools — every one of them. Absent
   *  means on. */
  mediaGeneration: z.boolean().optional(),
  /** The user's switch for searching the web. Absent means on. */
  webSearch: z.boolean().optional()
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
