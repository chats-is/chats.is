import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useCallback,
  useRef
} from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';

import { Attachment } from '@/types';
import { uploadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface AttachmentsButtonProps {
  disabled?: boolean;
  /** Accepted file extensions; defaults to images. */
  accept?: string;
  uploadQueue: string[];
  setUploadQueue: Dispatch<SetStateAction<Array<string>>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
}

export const AttachmentsButton = ({
  disabled,
  accept = '.jpg,.jpeg,.png,.gif,.webp',
  uploadQueue,
  setUploadQueue,
  attachments,
  setAttachments
}: AttachmentsButtonProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);

      if (attachments.length + files.length > 5) {
        toast.error('Maximum of 5 files allowed for upload');
        return;
      }

      setUploadQueue(files.map(file => file.name));

      try {
        const uploadPromises = files.map(async file => {
          const result = await uploadFile(file);
          if (result && 'error' in result) {
            toast.error(result.error);
            return;
          }
          return result;
        });
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          attachment => attachment !== undefined
        );
        setAttachments(currentAttachments => [
          ...currentAttachments,
          ...successfullyUploadedAttachments
        ]);
      } catch (error) {
        console.error('Uploading files error: ', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [attachments, setAttachments, setUploadQueue]
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 rounded-full text-muted-foreground shadow-none"
          disabled={uploadQueue.length > 0 || disabled}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          {uploadQueue.length > 0 ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <input
                multiple
                disabled={uploadQueue.length > 0 || disabled}
                ref={fileInputRef}
                tabIndex={-1}
                className="hidden"
                type="file"
                accept={accept}
                onChange={handleFileChange}
              />
              <Paperclip className="size-4" />
            </>
          )}
          <span className="sr-only">Upload attachments</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Upload attachments (Max 5, 5MB)</TooltipContent>
    </Tooltip>
  );
};
