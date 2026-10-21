import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { type Attachment, type Model } from '@/types';
import { uploadFile } from '@/lib/api';
import { UPLOAD_CONFIG } from '@/lib/constant';
import { documentMediaTypeOf } from '@/lib/document';
import { maxSizeForPathname } from '@/lib/upload-config';
import { generateUUID } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
import { type PendingUpload } from '@/components/attachments-preview';

const MAX_ATTACHMENTS = 20;

const ALLOWED_TYPES = new Set<string>(UPLOAD_CONFIG.attachment.allowedTypes);

/**
 * What kinds of file a message can take. An image is worth taking for either
 * of two things, each decided on its own: the chat model looking at it, or a
 * tool working from it — editing it, or animating it into a video. Whether
 * the model itself sees an image stays with `supportsVision`: without it, the
 * server hands the model the image's address, which is what the tools take.
 * Audio and video are taken on the same terms: when a tool can act on them —
 * transcribing audio, editing a video. With the media tools switched off,
 * none of those is offered.
 */
function canAttach({
  supportsVision,
  mediaGeneration,
  imageModels,
  videoModels,
  sttModels
}: {
  supportsVision: boolean;
  mediaGeneration: boolean;
  imageModels?: Model[];
  videoModels?: Model[];
  sttModels?: Model[];
}) {
  return {
    canAttachImages:
      supportsVision ||
      (mediaGeneration &&
        (!!imageModels?.some(model => model.supportsImageEdit) ||
          !!videoModels?.some(model => model.supportsImageToVideo))),
    canAttachAudio: mediaGeneration && !!sttModels?.length,
    canAttachVideo:
      mediaGeneration && !!videoModels?.some(model => model.supportsVideoEdit)
  };
}

/**
 * The files of a message being written — the chat's, and a prompt's tried
 * from its dialog, which goes to the chat as one: what kinds it can take for
 * the models it goes to (`canAttach`), the files attached and those on their
 * way, and adding them — picked, dropped on the page, or pasted — each held
 * to the same terms: a kind those models can do something with, no larger
 * than storage takes, and no more of them than a message carries. Each is
 * shown the moment it is added and uploads on its own, so more can be added
 * while others are on their way, and one that fails stays in view, marked.
 * `preview` is what `AttachmentsPreview` shows them from.
 */
export function useAttachmentUpload(models: Parameters<typeof canAttach>[0]) {
  const { canAttachImages, canAttachAudio, canAttachVideo } = canAttach(models);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // The upload goes straight to blob storage under this user's own path, which
  // the token route checks against the session before it signs anything.
  const { user } = useCurrentUser();

  // What already holds a place in the message: attached, or on its way. A
  // failed upload holds none.
  const occupied =
    attachments.length + uploads.filter(upload => !upload.error).length;
  const limitMessage = `Maximum of ${MAX_ATTACHMENTS} files allowed for upload`;

  /** Why a file is not taken — the same terms the picker's list of types
   *  offers, for a file that came some other way. */
  const refusal = useCallback(
    (file: File): string | null => {
      if (!ALLOWED_TYPES.has(file.type)) {
        return `${file.name} is not a kind of file a message can carry`;
      }
      if (file.type.startsWith('image/') && !canAttachImages) {
        return `${file.name}: the selected model can’t see images, and no tool can use them`;
      }
      if (file.type.startsWith('audio/') && !canAttachAudio) {
        return `${file.name}: no tool can use audio`;
      }
      if (file.type.startsWith('video/') && !canAttachVideo) {
        return `${file.name}: no tool can use video`;
      }
      // Storage refuses a file over its size only once it has started to
      // arrive, and says so in bytes; the same limit is checked here first,
      // and said plainly.
      const limit = maxSizeForPathname('attachment', file.name);
      if (file.size > limit) {
        return `${file.name} is larger than ${limit / 1024 / 1024} MB, the most one file can be`;
      }
      return null;
    },
    [canAttachImages, canAttachAudio, canAttachVideo]
  );

  const addFiles = useCallback(
    async (chosen: File[]) => {
      // A document is stored under the type its extension says, not the one
      // the browser guessed.
      const typed = chosen.map(file => {
        const type = documentMediaTypeOf(file.name);
        return type && type !== file.type
          ? new File([file], file.name, { type })
          : file;
      });
      const files = typed.filter(file => {
        const reason = refusal(file);
        if (reason) toast.error(reason);
        return !reason;
      });
      if (!files.length) return;

      if (occupied + files.length > MAX_ATTACHMENTS) {
        toast.error(limitMessage);
        return;
      }

      if (!user?.id) {
        toast.error('Please sign in again to upload');
        return;
      }
      const userId = user.id;

      const pending: PendingUpload[] = files.map(file => ({
        id: generateUUID(),
        name: file.name,
        contentType: file.type,
        previewUrl: file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined,
        progress: 0,
        controller: new AbortController()
      }));
      setUploads(current => [...current, ...pending]);

      await Promise.all(
        files.map(async (file, index) => {
          const upload = pending[index];
          const update = (patch: Partial<PendingUpload>) =>
            setUploads(current =>
              current.map(u => (u.id === upload.id ? { ...u, ...patch } : u))
            );

          const result = await uploadFile(file, {
            userId,
            onProgress: progress => update({ progress }),
            abortSignal: upload.controller.signal
          });
          // Cancelled from the preview, which has already let it go.
          if (upload.controller.signal.aborted) return;

          if (!result || 'error' in result) {
            const message = result?.error ?? 'Upload failed';
            update({ error: message });
            toast.error(`${file.name}: ${message}`);
            return;
          }

          if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
          setUploads(current => current.filter(u => u.id !== upload.id));
          setAttachments(current => [...current, result]);
        })
      );
    },
    [refusal, occupied, limitMessage, setAttachments, setUploads, user?.id]
  );

  /** When the message has no room left, says so and answers true. For a
   *  file asked of the user (a screenshot) before it exists, so their choice
   *  is not spent on a file that is then turned away. */
  const refuseWhenFull = useCallback(() => {
    if (occupied < MAX_ATTACHMENTS) return false;
    toast.error(limitMessage);
    return true;
  }, [occupied, limitMessage]);

  /** Lets every file go, once the message is on its way. Only failed
   *  uploads can be left by then — sending waits for the rest. */
  const clear = useCallback(() => {
    setAttachments([]);
    setUploads(current => {
      for (const upload of current) {
        if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      }
      return [];
    });
  }, []);

  return {
    canAttachImages,
    canAttachAudio,
    canAttachVideo,
    attachments,
    /** Sending waits for what is still uploading; a failed one does not
     *  hold it. */
    uploading: uploads.some(upload => !upload.error),
    addFiles,
    refuseWhenFull,
    clear,
    preview: { uploads, setUploads, attachments, setAttachments }
  };
}
