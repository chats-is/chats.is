import {
  useCallback,
  useTransition,
  type Dispatch,
  type SetStateAction
} from 'react';
import {
  AudioLines,
  CircleAlert,
  Clapperboard,
  Loader2,
  XCircle
} from 'lucide-react';

import { type Attachment } from '@/types';
import { deleteFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A file on its way to storage: shown at once in the place it will take, with
 * how far it has got — or, when it did not arrive, as failed and why.
 */
export type PendingUpload = {
  id: string;
  name: string;
  contentType: string;
  /** A local URL for an image, so it shows before it has uploaded. */
  previewUrl?: string;
  /** 0–100. */
  progress: number;
  error?: string;
  controller: AbortController;
};

interface AttachmentsPreviewProps {
  disabled?: boolean;
  uploads: PendingUpload[];
  setUploads: Dispatch<SetStateAction<Array<PendingUpload>>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  className?: string;
}

export const AttachmentsPreview = ({
  disabled,
  uploads,
  setUploads,
  attachments,
  setAttachments,
  className
}: AttachmentsPreviewProps) => {
  const [isPending, startTransition] = useTransition();

  const removeAttachment = useCallback(
    async (url: string, index: number) => {
      await deleteFile(url);
      setAttachments(prevAttachments =>
        prevAttachments.filter((_, i) => i !== index)
      );
    },
    [setAttachments]
  );

  // Removing one still on its way stops it; a failed one is simply let go.
  const removeUpload = useCallback(
    (upload: PendingUpload) => {
      upload.controller.abort();
      if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
      setUploads(current => current.filter(u => u.id !== upload.id));
    },
    [setUploads]
  );

  return (
    (attachments.length > 0 || uploads.length > 0) && (
      <div
        className={cn(
          'mx-3 flex space-x-2 rounded-t-xl border border-b-0 bg-muted p-3 shadow-md',
          className
        )}
      >
        {attachments.map((attachment, index) => (
          <div key={index} className="relative">
            <div
              className={cn(
                'h-7 w-11 cursor-pointer overflow-hidden rounded-lg border p-px sm:h-16 sm:w-24',
                { 'opacity-50': isPending }
              )}
            >
              {attachment.contentType?.startsWith('audio/') ? (
                <div
                  title={attachment.name}
                  className="flex size-full items-center justify-center rounded-md bg-background"
                >
                  <AudioLines className="size-5 text-muted-foreground" />
                </div>
              ) : attachment.contentType?.startsWith('video/') ? (
                // A poster frame would need the file decoded; the icon says
                // what was attached, which is what an <img> could not.
                <div
                  title={attachment.name}
                  className="flex size-full items-center justify-center rounded-md bg-background"
                >
                  <Clapperboard className="size-5 text-muted-foreground" />
                </div>
              ) : (
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  className="size-full rounded-md object-cover"
                />
              )}
            </div>
            <Button
              type="button"
              variant="link"
              className="group absolute -top-1.5 -right-1.5 size-5 p-0 disabled:opacity-100"
              disabled={isPending || disabled}
              onClick={() =>
                startTransition(() => removeAttachment(attachment.url, index))
              }
            >
              <XCircle className="size-5 rounded-full bg-background text-muted-foreground group-hover:bg-red-400 group-hover:text-white group-disabled:pointer-events-none group-disabled:opacity-80" />
              <span className="sr-only">Remove attachment</span>
            </Button>
          </div>
        ))}

        {uploads.map(upload => (
          <div
            key={upload.id}
            className="relative"
            title={
              upload.error ? `${upload.name}: ${upload.error}` : upload.name
            }
          >
            <div className="relative h-7 w-11 overflow-hidden rounded-lg border p-px sm:h-16 sm:w-24">
              {upload.previewUrl ? (
                <img
                  src={upload.previewUrl}
                  alt={upload.name}
                  className="size-full rounded-md object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center rounded-md bg-background">
                  {upload.contentType.startsWith('video/') ? (
                    <Clapperboard className="size-5 text-muted-foreground" />
                  ) : (
                    <AudioLines className="size-5 text-muted-foreground" />
                  )}
                </div>
              )}
              {upload.error ? (
                <div className="absolute inset-px flex items-center justify-center rounded-md bg-destructive/70 text-white">
                  <CircleAlert className="size-5" />
                  <span className="sr-only">Upload failed</span>
                </div>
              ) : (
                <div className="absolute inset-px flex items-center justify-center rounded-md bg-background/60">
                  <Loader2 className="size-4 animate-spin text-foreground" />
                  <span className="sr-only">Uploading</span>
                  <div
                    className="absolute bottom-0 left-0 h-1 bg-primary transition-[width]"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="link"
              className="group absolute -top-1.5 -right-1.5 size-5 p-0 disabled:opacity-100"
              onClick={() => removeUpload(upload)}
            >
              <XCircle className="size-5 rounded-full bg-background text-muted-foreground group-hover:bg-red-400 group-hover:text-white" />
              <span className="sr-only">
                {upload.error ? 'Remove failed upload' : 'Cancel upload'}
              </span>
            </Button>
          </div>
        ))}
      </div>
    )
  );
};
