'use client';

import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Attachment } from '@/types';
import { uploadFile } from '@/lib/api';
import { modelMatchesId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

const IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const AUDIO_TYPES = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
const MAX_ATTACHMENTS = 5;

interface UploadButtonProps {
  disabled?: boolean;
  /** Vision-capable chat model selected. */
  canAttachImages: boolean;
  uploadQueue: string[];
  setUploadQueue: Dispatch<SetStateAction<Array<string>>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
}

/**
 * The composer's `+` — the one thing a user adds to a message by hand.
 *
 * It opens the file dialog directly rather than a menu of one item. Which
 * media models generate what is not a choice made per message: the chat model
 * picks the tool from what was asked, and the models it uses are configured
 * once, in the settings beside the model picker.
 *
 * Accepted types follow what this setup can do with a file: images need a
 * vision-capable chat model, audio an STT model to transcribe it.
 */
export function UploadButton({
  disabled,
  canAttachImages,
  uploadQueue,
  setUploadQueue,
  attachments,
  setAttachments
}: UploadButtonProps) {
  // Same hydration guard the other controls in this form use.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sttModels, defaults } = useSystemSettings();
  const { preferences, setPreference } = usePreferences();

  const uploading = uploadQueue.length > 0;
  const sttModelId = preferences.sttModelId || defaults.sttModelId || '';
  const hasSttModels = !!sttModels?.length;

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      // Reset first: picking the same file twice in a row fires no change event
      // otherwise, so a removed-then-re-added attachment would look ignored.
      e.target.value = '';
      if (!files.length) return;

      if (attachments.length + files.length > MAX_ATTACHMENTS) {
        toast.error(`Maximum of ${MAX_ATTACHMENTS} files allowed for upload`);
        return;
      }

      setUploadQueue(files.map(file => file.name));

      // Audio is transcribed on arrival, so an audio file needs a model that
      // can do it settled now — an upload with nothing to transcribe it would
      // be accepted and then fail on the server. Validity, not emptiness: a
      // stored preference can name a model that has since been deleted.
      const hasAudio = files.some(file =>
        AUDIO_TYPES.some(ext => file.name.toLowerCase().endsWith(ext))
      );
      if (
        hasAudio &&
        sttModels?.length &&
        !sttModels.some(model => modelMatchesId(model, sttModelId))
      ) {
        setPreference('sttModelId', sttModels[0].modelId);
      }

      try {
        const uploaded = await Promise.all(
          files.map(async file => {
            const result = await uploadFile(file);
            if (result && 'error' in result) {
              toast.error(result.error);
              return;
            }
            return result;
          })
        );
        setAttachments(current => [
          ...current,
          ...uploaded.filter(attachment => attachment !== undefined)
        ]);
      } catch (error) {
        console.error('Uploading files error: ', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [
      attachments,
      setAttachments,
      setUploadQueue,
      sttModels,
      sttModelId,
      setPreference
    ]
  );

  const accept = [
    ...(canAttachImages ? IMAGE_TYPES : []),
    ...(hasSttModels ? AUDIO_TYPES : [])
  ].join(',');

  if (!accept) {
    return null;
  }

  if (!mounted) {
    return <Skeleton className="size-9 rounded-full" />;
  }

  return (
    <>
      <input
        multiple
        ref={fileInputRef}
        tabIndex={-1}
        className="hidden"
        type="file"
        accept={accept}
        disabled={disabled || uploading}
        onChange={handleFileChange}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled || uploading}
            className="size-9 rounded-full text-muted-foreground shadow-none"
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            <span className="sr-only">Upload attachment</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Upload attachment · up to {MAX_ATTACHMENTS} files, 5MB each
        </TooltipContent>
      </Tooltip>
    </>
  );
}
