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
import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus
} from 'lucide-react';
import { toast } from 'sonner';

import { Attachment, MediaKind } from '@/types';
import { uploadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
const MAX_ATTACHMENTS = 5;

interface ComposerAddMenuProps {
  disabled?: boolean;
  /** Vision-capable chat model selected. */
  canAttachImages: boolean;
  uploadQueue: string[];
  setUploadQueue: Dispatch<SetStateAction<Array<string>>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  /** Surface this kind's model and options in the toolbar. */
  onSelectMedia: (kind: MediaKind) => void;
}

/**
 * The composer's `+` — the one place a message gets something added to it.
 *
 * Actions only, which is what a `+` promises: attach this, create that.
 * Uploading used to be a paperclip beside Send (an input action stranded in
 * the row's outgoing corner) and the media models had a settings panel of
 * their own; the panel's controls now appear in the toolbar for whichever kind
 * was picked here, so choosing and configuring stay separate.
 *
 * Each entry is listed only when it would work, and the upload row's accepted
 * types follow the same rule: images need a vision-capable chat model, audio
 * an STT model to transcribe it, a creation kind a model of that capability.
 */
export function ComposerAddMenu({
  disabled,
  canAttachImages,
  uploadQueue,
  setUploadQueue,
  attachments,
  setAttachments,
  onSelectMedia
}: ComposerAddMenuProps) {
  // Same hydration guard the other Radix controls in this form use.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { imageModels, videoModels, ttsModels, sttModels, defaults } =
    useSystemSettings();
  const { preferences, setPreference } = usePreferences();

  const uploading = uploadQueue.length > 0;

  // Audio uploads are offered whenever the platform has a model that could
  // transcribe them. This used to require one to be *selected*, which left a
  // dead end: with no admin default and no prior choice the row never appeared,
  // and the only control that sets the preference is the one it reveals.
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

      // Audio is transcribed on arrival, so an audio file makes the STT model
      // part of what was just added: settle which one it is (an upload with
      // nothing to transcribe it would be accepted and then fail on the
      // server) and show it in the toolbar.
      const hasAudio = files.some(file =>
        AUDIO_TYPES.some(ext => file.name.toLowerCase().endsWith(ext))
      );
      if (hasAudio && sttModels?.length) {
        if (!sttModelId) {
          setPreference('sttModelId', sttModels[0].modelId);
        }
        onSelectMedia('stt');
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
      setPreference,
      onSelectMedia
    ]
  );

  // The menu closes itself on select, which steals the click if the dialog
  // opens in the same frame.
  const pick = () => requestAnimationFrame(() => fileInputRef.current?.click());

  const hasImageModels = !!imageModels?.length;
  const hasVideoModels = !!videoModels?.length;
  const hasTtsModels = !!ttsModels?.length;

  const hasUploads = canAttachImages || hasSttModels;
  // One row, so one accept list: whatever this setup can actually take. Images
  // need a vision-capable chat model, audio an STT model to transcribe it.
  const accept = [
    ...(canAttachImages ? IMAGE_TYPES : []),
    ...(hasSttModels ? AUDIO_TYPES : [])
  ].join(',');
  const hasGenerators = hasImageModels || hasVideoModels || hasTtsModels;

  if (!hasUploads && !hasGenerators) {
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
        <DropdownMenuContent align="start" className="w-52">
          {hasUploads && (
            <DropdownMenuItem onSelect={pick}>
              <Paperclip className="size-4" />
              Upload attachment
            </DropdownMenuItem>
          )}

          {hasUploads && hasGenerators && <DropdownMenuSeparator />}

          {hasImageModels && (
            <DropdownMenuItem onSelect={() => onSelectMedia('image')}>
              <ImageIcon className="size-4" />
              Create image
            </DropdownMenuItem>
          )}
          {hasVideoModels && (
            <DropdownMenuItem onSelect={() => onSelectMedia('video')}>
              <Clapperboard className="size-4" />
              Create video
            </DropdownMenuItem>
          )}
          {/* `Create audio` rather than `Text to speech`: it keeps the verb
              parallel with the two above, and "create a speech" reads in
              English as writing one. */}
          {hasTtsModels && (
            <DropdownMenuItem onSelect={() => onSelectMedia('audio')}>
              <AudioLines className="size-4" />
              Create audio
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
