import { z } from 'zod';

import { type Chat } from './chat';

export type SharedLink = {
  id: string;
  chat?: Chat;
  createdAt: Date;
};

/** What the share server functions accept. */
export const shareChatSchema = z.object({ chatId: z.string().min(1) });
export const shareIdSchema = z.object({ id: z.string().min(1) });
export const sharePageSchema = z.object({
  limit: z.number().min(1).default(50).optional(),
  offset: z.number().min(0).default(0).optional()
});
