import { z } from 'zod';

import { type Chat } from './chat';
import { paginationSchema } from './pagination';

export type SharedLink = {
  id: string;
  chat?: Chat;
  createdAt: Date;
};

/** What the share server functions accept. */
export const shareChatSchema = z.object({ chatId: z.string().min(1) });
export const shareIdSchema = z.object({ id: z.string().min(1) });
/** The Shared Links table, cut to one page. */
export const sharePageSchema = z.object({ ...paginationSchema.shape });
