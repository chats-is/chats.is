import { createFileRoute } from '@tanstack/react-router';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { publicEnv } from '@/lib/env.public';
import {
  isUploadType,
  maxSizeForPathname,
  UPLOAD_CONFIG
} from '@/lib/upload-config';
import { getUser } from '@/server/session';

export const Route = createFileRoute('/api/files/upload')({
  server: {
    handlers: { POST }
  }
});

/**
 * Signs a token for one upload, which the browser then sends straight to blob
 * storage — and receives the completion callback afterwards. No file passes
 * through here: a Vercel function cannot receive more than 4.5 MB of request
 * body on any plan, and video does not fit. Nothing here touches the bytes: a Vercel function cannot receive
 * more than 4.5 MB of request body on any plan, and video does not fit.
 *
 * The token is the only thing standing between the store and the internet, so
 * everything is decided here, before it is signed:
 *
 *   - the session, without which no token is issued at all;
 *   - the path, which must be the one this user's uploads live under — the
 *     browser proposes it and could propose anyone's, so it is compared
 *     against the session rather than trusted;
 *   - the content types and the size ceiling, which blob storage enforces.
 *
 * A random suffix is added on top: two uploads of the same name cannot
 * collide, and no path can be guessed from another user's.
 */
async function POST({ request: req }: { request: Request }) {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await getUser();
        if (!user) {
          throw new Error('Unauthorized');
        }

        const type = clientPayload ?? '';
        if (!isUploadType(type)) {
          throw new Error('Invalid upload type');
        }

        const prefix = [
          publicEnv.VITE_UPLOAD_PATH,
          UPLOAD_CONFIG[type].folder,
          user.id
        ]
          .filter(Boolean)
          .join('/');
        const filename = pathname.slice(prefix.length + 1);
        if (
          !pathname.startsWith(`${prefix}/`) ||
          !filename ||
          filename.includes('/')
        ) {
          throw new Error('Invalid upload path');
        }

        return {
          allowedContentTypes: [...UPLOAD_CONFIG[type].allowedTypes],
          maximumSizeInBytes: maxSizeForPathname(type, pathname),
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id, type })
        };
      },
      // Blob calls this when the upload lands. Nothing depends on it: the
      // browser carries the returned URL into the message it is attached to,
      // which is also why uploads work in local development, where Blob cannot
      // reach localhost to call back at all.
      onUploadCompleted: async () => {}
    });

    return Response.json(result);
  } catch (error) {
    console.error('[upload] token request failed:', error);
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
