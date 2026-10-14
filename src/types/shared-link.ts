import { z } from 'zod';

import { type Artifact } from './artifact';
import { type Chat } from './chat';
import { paginationSchema } from './pagination';

/** A share link: of a whole chat, or of one artifact on its own. */
export type SharedLink = {
  id: string;
  chat?: Pick<Chat, 'id' | 'title'> | null;
  artifact?: Pick<Artifact, 'id' | 'title' | 'type'> | null;
  createdAt: Date;
};

/** What the share server functions accept. */
export const shareChatSchema = z.object({ chatId: z.string().min(1) });
export const shareArtifactSchema = z.object({ artifactId: z.string().min(1) });
export const shareIdSchema = z.object({ id: z.string().min(1) });
/** The Shared Links table, cut to one page. */
export const sharePageSchema = z.object({ ...paginationSchema.shape });
