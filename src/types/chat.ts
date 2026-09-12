import { z } from 'zod';

import { type Artifact } from './artifact';
import { messageSchema, type ChatMessage } from './message';

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
