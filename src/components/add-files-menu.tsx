import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent
} from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { Camera, Check, Globe, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { DOCUMENT_MEDIA_TYPES } from '@/lib/constant';
import { canCaptureScreen, captureScreenshot } from '@/lib/screenshot';
import { cn } from '@/lib/utils';
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
const VIDEO_TYPES = ['.mp4', '.mov', '.webm'];
// Every chat model can take a document: what it cannot read as a file, it is
// given as the document's text.
const DOCUMENT_TYPES = Object.keys(DOCUMENT_MEDIA_TYPES).map(
  extension => `.${extension}`
);

/** The file picker's list of types, for what can be taken — a document
 *  always. Shared with a prompt's dialog, so both offer the same files. */
export function acceptedFiles({
  canAttachImages,
  canAttachAudio,
  canAttachVideo
}: {
  canAttachImages: boolean;
  canAttachAudio: boolean;
  canAttachVideo: boolean;
}) {
  return [
    ...(canAttachImages ? IMAGE_TYPES : []),
    ...(canAttachAudio ? AUDIO_TYPES : []),
    ...(canAttachVideo ? VIDEO_TYPES : []),
    ...DOCUMENT_TYPES
  ].join(',');
}

interface AddFilesMenuProps {
  disabled?: boolean;
  /** An image can be taken: the chat model sees it, or a tool uses it. */
  canAttachImages: boolean;
  /** An audio file can be taken: a model transcribes it. */
  canAttachAudio: boolean;
  /** A video can be taken: a model edits it. */
  canAttachVideo: boolean;
  /** Whether a search could happen on the current model; the switch is
   *  offered only then. */
  canSearchWeb: boolean;
  /** Adds files to the message (see `useAttachmentUpload`). */
  addFiles: (files: File[]) => Promise<void>;
  /** Turns a file away before it exists when the message has no room left,
   *  saying so; answers whether it did. */
  refuseWhenFull: () => boolean;
}

/**
 * The composer's `+` — what a user adds to a message by hand.
 *
 * Which media models generate what is not a choice made per message: the chat
 * model picks the tool from what was asked, and the models it uses are
 * configured once, in the settings beside the model picker. So this menu is
 * about what a message carries: files, and a screenshot taken on the spot. The
 * accepted types follow what this setup can do with a file: an image, when the
 * chat model looks at it or a tool edits or animates it; audio, when a model
 * transcribes it; video, when one edits it; a document, always. A screenshot
 * is an image, and is offered where images are.
 */
export function AddFilesMenu({
  disabled,
  canAttachImages,
  canAttachAudio,
  canAttachVideo,
  canSearchWeb,
  addFiles,
  refuseWhenFull
}: AddFilesMenuProps) {
  // Same hydration guard the other controls in this form use.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { preferences, setPreference } = usePreferences();

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      // Reset first: picking the same file twice in a row fires no change event
      // otherwise, so a removed-then-re-added attachment would look ignored.
      e.target.value = '';
      await addFiles(files);
    },
    [addFiles]
  );

  const handleScreenshot = useCallback(async () => {
    // Checked before the capture, not after: asking for a screen to share
    // and then turning the picture away wastes the user's choice.
    if (refuseWhenFull()) return;
    try {
      const file = await captureScreenshot();
      if (file) await addFiles([file]);
    } catch (error) {
      console.error('Screenshot error: ', error);
      toast.error('Could not take a screenshot');
    }
  }, [refuseWhenFull, addFiles]);

  const accept = acceptedFiles({
    canAttachImages,
    canAttachAudio,
    canAttachVideo
  });
  // A screenshot is an image, so it goes where images may — and only where
  // the browser can capture the screen at all.
  const canScreenshot = canAttachImages && canCaptureScreen();

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
        disabled={disabled}
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
                disabled={disabled}
                className="size-9 rounded-full text-muted-foreground shadow-none"
              >
                <Plus className="size-4" />
                <span className="sr-only">Add to this message</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Add to this message</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onSelect={() =>
              // The menu closes itself on select, which steals the click if
              // the dialog opens in the same frame.
              requestAnimationFrame(() => fileInputRef.current?.click())
            }
          >
            <Paperclip className="size-4" />
            Add files or photos
          </DropdownMenuItem>
          {canScreenshot && (
            <DropdownMenuItem onSelect={() => void handleScreenshot()}>
              <Camera className="size-4" />
              Take a screenshot
            </DropdownMenuItem>
          )}
          {canSearchWeb && <DropdownMenuSeparator />}
          {/* A setting, chosen like an action: one pick, and the menu
              closes. Its icon sits where the other items' do, and the check
              at the right, where a setting's state is read. Offered only
              when a search could happen: a switch that does nothing is worse
              than none. */}
          {canSearchWeb && (
            <DropdownMenuItem
              role="menuitemcheckbox"
              aria-checked={preferences.webSearch}
              onSelect={() =>
                setPreference('webSearch', !preferences.webSearch)
              }
            >
              <Globe className="size-4" />
              Web search
              <Check
                className={cn(
                  'ml-auto size-4',
                  !preferences.webSearch && 'invisible'
                )}
              />
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
