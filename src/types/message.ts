import { type UIMessage } from 'ai';
import { type InferSelectModel } from 'drizzle-orm';
import { z } from 'zod';

import { type messages } from '@/db/schema';

import { type ChatTools } from './chat-tools';
import {
  dataUIPartSchema,
  dynamicToolUIPartSchema,
  fileUIPartSchema,
  reasoningUIPartSchema,
  sourceDocumentUIPartSchema,
  sourceUrlUIPartSchema,
  stepStartUIPartSchema,
  textUIPartSchema,
  toolUIPartSchema
} from './content-part';
import { type CustomUIDataTypes } from './ui-data';

export type DBMessage = Omit<
  InferSelectModel<typeof messages>,
  'userId' | 'chatId'
>;

export const messageMetadataSchema = z.object({
  parentId: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  reasonDuration: z.number().int().nonnegative().optional()
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(
    z.union([
      textUIPartSchema,
      reasoningUIPartSchema,
      toolUIPartSchema,
      dynamicToolUIPartSchema,
      sourceUrlUIPartSchema,
      sourceDocumentUIPartSchema,
      fileUIPartSchema,
      dataUIPartSchema,
      stepStartUIPartSchema
    ])
  ),
  metadata: messageMetadataSchema.optional()
});

/**
 * A message as a user can send one: what they typed, and files.
 *
 * Narrower than a stored message on purpose. The parts are kept as sent and
 * read back on every later turn, so whatever is let in here is let in for the
 * life of the chat — and a tool part would be a result no tool produced, which
 * the media tools then trust as a file of this conversation.
 *
 * Where a file lives is not asked here. Only the server knows which store is
 * this install's, and it asks that of a message being sent for the first time
 * (`carriesOnlyOwnFiles`); a message already stored is resent as it stands,
 * and one from before this store existed must still be able to be.
 */
export const userMessageSchema = messageSchema.extend({
  role: z.literal('user'),
  parts: z.array(z.union([textUIPartSchema, fileUIPartSchema])).min(1)
});

/** What the message server functions accept. */
export const messageChatSchema = z.object({ chatId: z.string().min(1) });

export const messageCreateSchema = z.object({
  chatId: z.string().min(1),
  messages: z.array(messageSchema)
});

/** Only a user's own message can be rewritten, so it is held to what a user
 *  may send in the first place. */
export const messageUpdateSchema = z.object({
  id: z.string().min(1),
  message: userMessageSchema
});

/** Either a single message and its replies, or a whole branch — never both
 *  and never neither. */
export const messageDeleteSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    parentId: z.string().trim().min(1).optional()
  })
  .refine(data => !!data.id !== !!data.parentId, {
    message: 'Provide either id or parentId, but not both or neither'
  });
