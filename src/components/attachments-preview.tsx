import {
  useCallback,
  useTransition,
  type Dispatch,
  type SetStateAction
} from 'react';
import { AudioLines, Clapperboard, XCircle } from 'lucide-react';

import { type Attachment } from '@/types';
import { deleteFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { Skeleton } from './ui/skeleton';

interface AttachmentsPreviewProps {
  disabled?: boolean;
  uploadQueue: string[];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
}

export const AttachmentsPreview = ({
  disabled,
  uploadQueue,
  attachments,
  setAttachments
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

  return (
    (attachments.length > 0 || uploadQueue.length > 0) && (
      <div className="mx-3 flex space-x-2 rounded-t-xl border border-b-0 bg-muted p-3 shadow-md">
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

        {uploadQueue.map(filename => (
          <Skeleton
            key={filename}
            className="h-7 w-11 rounded-lg p-px sm:h-16 sm:w-24"
          />
        ))}
      </div>
    )
  );
};
