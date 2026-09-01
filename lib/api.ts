import { upload } from '@vercel/blob/client';

import { Attachment, Result } from '@/types';
import { env } from '@/lib/env';
import { UPLOAD_CONFIG, type UploadType } from '@/lib/upload-config';
import { generateUUID } from '@/lib/utils';

export const createSpeech = async (
  modelId: string,
  /** Omitted when the user has picked none — the model's own default applies. */
  voice: string | undefined,
  text: string
) => {
  const res = await fetch('/api/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ modelId, voice, text })
  });

  if (!res.ok) {
    const result = await res.json();
    return { error: result.error } as Result;
  }

  const json = await res.json();
  return json as { audio: string };
};

/**
 * Send a file straight from the browser to blob storage.
 *
 * It does not pass through a function on the way: Vercel caps a function's
 * request body at 4.5 MB on every plan, which rules out video and most audio.
 * `/api/files/upload` only signs a token for this one path, having checked
 * the session and decided the size and type limits — see that route for what
 * the token allows.
 *
 * The name is generated rather than taken from the file, so nothing about the
 * user's filesystem ends up in a public URL; the original name travels with
 * the attachment instead.
 */
export const uploadFile = async (
  file: File,
  options: { userId: string; type?: UploadType }
): Promise<Attachment | Result> => {
  const type = options.type ?? 'attachment';
  const ext = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    : (file.type.split('/')[1] ?? 'bin');

  const pathname = [
    env.NEXT_PUBLIC_UPLOAD_PATH,
    UPLOAD_CONFIG[type].folder,
    options.userId,
    `${generateUUID()}.${ext}`
  ]
    .filter(Boolean)
    .join('/');

  try {
    const blob = await upload(pathname, file, {
      access: 'public',
      contentType: file.type,
      handleUploadUrl: '/api/files/upload',
      clientPayload: type
    });

    return {
      url: blob.url,
      name: file.name,
      contentType: blob.contentType || file.type
    };
  } catch (error) {
    return { error: (error as Error).message } as Result;
  }
};

export const deleteFile = async (url: string) => {
  const res = await fetch(`/api/files?url=${encodeURIComponent(url)}`, {
    method: 'DELETE'
  });

  if (!res.ok) {
    const result = await res.json();
    return { error: result.error } as Result;
  }
};
