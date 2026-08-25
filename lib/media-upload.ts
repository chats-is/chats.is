import 'server-only';

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
  // Join with '/' rather than path.join: this is a blob storage key, not a
  // filesystem path. Two reasons it matters — path.join would emit backslashes
  // on Windows and corrupt the key, and @vercel/nft reads a path.join() call as
  // a filesystem access. Since the upload path is only known at runtime, the
  // tracer cannot resolve it and falls back to bundling the whole project root
  // into every function that reaches this file (.git and .env included).
  const pathname = [
    env.NEXT_PUBLIC_UPLOAD_PATH,
    args.kind,
    args.userId,
    filename
  ]
    .filter(Boolean)
    .join('/');
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
