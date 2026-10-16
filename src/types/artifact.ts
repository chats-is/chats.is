import { z } from 'zod';

import { type PREVIEW_PACKAGES } from '@/lib/constant';

export const artifactTypeSchema = z.enum([
  'code',
  'markdown',
  'html',
  'json',
  'text'
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

/** A package a React artifact's preview can import, as the model writes it. */
export type PreviewPackage = (typeof PREVIEW_PACKAGES)[number]['name'];

export type Artifact = {
  id: string;
  chatId: string;
  messageId: string;
  userId?: string;
  title: string;
  type: ArtifactType;
  language?: string | null;
  content?: string | null;
  fileName?: string | null;
  status?: 'streaming' | 'idle';
  createdAt: Date;
  updatedAt: Date;
};

/** A file an artifact can read, by the name it goes by in the chat. */
export type ArtifactFile = { name: string; url: string };

/** What the artifact server functions accept. */
export const artifactIdSchema = z.object({ id: z.string().min(1) });
export const artifactChatSchema = z.object({ chatId: z.string().min(1) });

/** An artifact to start a new chat from: one of the user's own, or one
 *  shared on its own, by its link. */
export const artifactDuplicateSchema = z.object({
  from: z.union([
    z.object({ artifactId: z.string().min(1) }),
    z.object({ shareId: z.string().min(1) })
  ])
});
