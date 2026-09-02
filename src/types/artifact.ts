import { z } from 'zod';

export const artifactTypeSchema = z.enum([
  'code',
  'markdown',
  'html',
  'json',
  'text',
  'image',
  'file'
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export type Artifact = {
  id: string;
  chatId: string;
  messageId: string;
  userId?: string;
  title: string;
  type: ArtifactType;
  language?: string | null;
  content?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  status?: 'streaming' | 'done' | 'idle';
  createdAt: Date;
  updatedAt: Date;
};
