import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction
} from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { Loader2, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { type Attachment } from '@/types';
import { uploadFile } from '@/lib/api';
import { modelMatchesId } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

const IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const AUDIO_TYPES = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
const VIDEO_TYPES = ['.mp4', '.mov', '.webm'];
const MAX_ATTACHMENTS = 5;

interface AddFilesMenuProps {
  disabled?: boolean;
  /** Vision-capable chat model selected. */
  canAttachImages: boolean;
  uploadQueue: string[];
  setUploadQueue: Dispatch<SetStateAction<Array<string>>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
}

/**
 * The composer's `+` — what a user adds to a message by hand.
 *
 * Which media models generate what is not a choice made per message: the chat
 * model picks the tool from what was asked, and the models it uses are
 * configured once, in the settings beside the model picker. So this menu is
 * about files, and the accepted types follow what this setup can do with one:
 * images need a vision-capable chat model, audio an STT model to transcribe it.
 */
export function AddFilesMenu({
  disabled,
  canAttachImages,
  uploadQueue,
  setUploadQueue,
  attachments,
  setAttachments
}: AddFilesMenuProps) {
  // Same hydration guard the other controls in this form use.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { sttModels, videoModels, defaults } = useSystemSettings();
  // The upload goes straight to blob storage under this user's own path, which
  // the token route checks against the session before it signs anything.
  const { user } = useCurrentUser();
  const { preferences, setPreference } = usePreferences();

  const uploading = uploadQueue.length > 0;
  const sttModelId = preferences.sttModelId || defaults.sttModelId || '';
  const hasSttModels = !!sttModels?.length;
  // A video is only worth taking when something can act on it.
  const canEditVideo = !!videoModels?.some(model => model.supportsVideoEdit);

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

      if (!user?.id) {
        toast.error('Please sign in again to upload');
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
            const result = await uploadFile(file, { userId: user.id });
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
      user?.id,
      sttModels,
      sttModelId,
      setPreference
    ]
  );

  const accept = [
    ...(canAttachImages ? IMAGE_TYPES : []),
    ...(hasSttModels ? AUDIO_TYPES : []),
    ...(canEditVideo ? VIDEO_TYPES : [])
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
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled || uploading}
                className="size-9 rounded-full text-muted-foreground shadow-none"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                <span className="sr-only">Add to this message</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Add to this message</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onSelect={() =>
              // The menu closes itself on select, which steals the click if the
              // dialog opens in the same frame.
              requestAnimationFrame(() => fileInputRef.current?.click())
            }
          >
            <Paperclip className="size-4" />
            Add files or photos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
