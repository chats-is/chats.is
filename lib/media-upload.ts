import 'server-only';

import path from 'path';
import { put } from '@vercel/blob';

import { env } from '@/lib/env';
import { generateUUID } from '@/lib/utils';

export type StoredMedia = {
  url: string;
  mediaType: string;
  filename: string;
};

/**
 * Upload a generated media buffer to Vercel Blob under the user's
 * per-kind directory. Returns the public URL plus the stored filename.
 */
export async function uploadGeneratedMedia(args: {
  userId: string;
  kind: 'generate-images' | 'generate-videos' | 'generate-audios';
  buffer: Buffer;
  mediaType: string;
  ext: string;
}): Promise<StoredMedia> {
  const filename = `${generateUUID()}.${args.ext}`;
  const pathname = path.join(env.UPLOAD_PATH, args.kind, args.userId, filename);
  const data = await put(pathname, args.buffer, {
    access: 'public',
    contentType: args.mediaType,
    addRandomSuffix: false
  });

  return {
    url: data.url,
    mediaType: data.contentType || args.mediaType,
    filename
  };
}
