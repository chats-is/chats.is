import {
  useCallback,
  useTransition,
  type Dispatch,
  type SetStateAction
} from 'react';
import { CircleAlert, Loader2, XCircle } from 'lucide-react';

import { type Attachment } from '@/types';
import { deleteFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { FileTypeIcon } from '@/components/file-type-icon';

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
          'mx-3 flex space-x-2 overflow-x-auto rounded-t-xl border border-b-0 bg-muted p-3 shadow-md',
          className
        )}
      >
        {attachments.map((attachment, index) => (
          <div key={index} className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    'size-11 cursor-pointer overflow-hidden rounded-lg border p-px sm:size-16',
                    { 'opacity-50': isPending }
                  )}
                >
                  {attachment.contentType?.startsWith('image/') ? (
                    <img
                      src={attachment.url}
                      alt={attachment.name}
                      className="size-full rounded-md object-cover"
                    />
                  ) : (
                    <FileTile
                      name={attachment.name}
                      contentType={attachment.contentType}
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>{attachment.name}</TooltipContent>
            </Tooltip>
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
          <div key={upload.id} className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative size-11 overflow-hidden rounded-lg border p-px sm:size-16">
                  {upload.previewUrl ? (
                    <img
                      src={upload.previewUrl}
                      alt={upload.name}
                      className="size-full rounded-md object-cover"
                    />
                  ) : (
                    <FileTile
                      name={upload.name}
                      contentType={upload.contentType}
                    />
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
              </TooltipTrigger>
              <TooltipContent>
                {upload.error ? `${upload.name}: ${upload.error}` : upload.name}
              </TooltipContent>
            </Tooltip>
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

/** A file that is not a picture: its icon in the middle, its name along the
 *  bottom where there is room for one. */
function FileTile({
  name,
  contentType
}: {
  name?: string;
  contentType?: string;
}) {
  return (
    <div className="flex size-full flex-col rounded-md bg-background">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <FileTypeIcon
          contentType={contentType}
          className="size-5 text-muted-foreground/60"
        />
      </div>
      <span className="hidden truncate px-1 pb-1 text-center text-[10px] leading-tight text-muted-foreground sm:block">
        {name}
      </span>
    </div>
  );
}
