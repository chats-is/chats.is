import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { z } from 'zod';

import { env } from '@/lib/env';
import { generateUUID } from '@/lib/utils';
import { auth } from '@/server/auth';

const UPLOAD_CONFIG = {
  avatar: {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    folder: 'avatars',
    useUUID: true
  },
  attachment: {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: [
      'image/jpeg',
      'image/png',
      // Audio attachments feed the chat transcribe_audio (STT) tool.
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/x-m4a',
      'audio/ogg',
      'audio/webm',
      'audio/flac'
    ],
    folder: 'attachments',
    useUUID: false
  },
  prompts: {
    maxSize: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    folder: 'prompts',
    useUUID: true
  }
} as const;

type UploadType = keyof typeof UPLOAD_CONFIG;

const createFileSchema = (type: UploadType) => {
  const uploadConfig = UPLOAD_CONFIG[type];
  return z.object({
    file: z
      .instanceof(Blob)
      .refine(file => file.size <= uploadConfig.maxSize, {
        message: `File size should be less than ${uploadConfig.maxSize / (1024 * 1024)}MB`
      })
      .refine(
        file =>
          (uploadConfig.allowedTypes as readonly string[]).includes('*') ||
          (uploadConfig.allowedTypes as readonly string[]).includes(file.type),
        {
          message: `File type should be ${uploadConfig.allowedTypes.map(t => t.split('/')[1]?.toUpperCase()).join(', ')}`
        }
      )
  });
};

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const type = req.nextUrl.searchParams.get('type') as UploadType | null;

  if (!type || !UPLOAD_CONFIG[type]) {
    const validTypes = Object.keys(UPLOAD_CONFIG).join(', ');
    return NextResponse.json(
      { error: `Invalid upload type. Valid types: ${validTypes}` },
      { status: 400 }
    );
  }

  const uploadConfig = UPLOAD_CONFIG[type];
  const formData = await req.formData();
  const file = formData.get('file') as Blob;

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }

  const FileSchema = createFileSchema(type);
  const validatedFile = FileSchema.safeParse({ file });

  if (!validatedFile.success) {
    const errorMessage =
      validatedFile.error.issues[0]?.message || 'Invalid file';
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const fileBuffer = await file.arrayBuffer();

  let filename: string;
  if (uploadConfig.useUUID) {
    const ext = file.type.split('/')[1] || 'png';
    filename = `${generateUUID()}.${ext}`;
  } else {
    filename = path.basename((formData.get('file') as File).name);
  }

  try {
    const pathname = path.join(
      env.UPLOAD_PATH,
      uploadConfig.folder,
      session.user.id,
      filename
    );
    const data = await put(pathname, fileBuffer, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false
    });

    return NextResponse.json({
      url: data.url,
      name: data.pathname,
      contentType: data.contentType
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
