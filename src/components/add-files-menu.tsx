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
import { Camera, Check, Globe, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { type Attachment } from '@/types';
import { uploadFile } from '@/lib/api';
import { DOCUMENT_MEDIA_TYPES } from '@/lib/constant';
import { documentMediaTypeOf } from '@/lib/document';
import { canCaptureScreen, captureScreenshot } from '@/lib/screenshot';
import { maxSizeForPathname } from '@/lib/upload-config';
import { cn, generateUUID } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
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
import { type PendingUpload } from '@/components/attachments-preview';

const IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const AUDIO_TYPES = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
const VIDEO_TYPES = ['.mp4', '.mov', '.webm'];
// Every chat model can take a document: what it cannot read as a file, it is
// given as the document's text.
const DOCUMENT_TYPES = Object.keys(DOCUMENT_MEDIA_TYPES).map(
  extension => `.${extension}`
);
const MAX_ATTACHMENTS = 20;

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
  uploads: PendingUpload[];
  setUploads: Dispatch<SetStateAction<Array<PendingUpload>>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
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
  uploads,
  setUploads,
  attachments,
  setAttachments
}: AddFilesMenuProps) {
  // Same hydration guard the other controls in this form use.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // The upload goes straight to blob storage under this user's own path, which
  // the token route checks against the session before it signs anything.
  const { user } = useCurrentUser();
  const { preferences, setPreference } = usePreferences();

  // What already holds a place in the message: attached, or on its way. A
  // failed upload holds none.
  const occupied =
    attachments.length + uploads.filter(upload => !upload.error).length;
  const limitMessage = `Maximum of ${MAX_ATTACHMENTS} files allowed for upload`;

  /**
   * Upload files and add them to the message — picked, or captured. Each is
   * shown the moment it is chosen and uploads on its own, so more can be added
   * while others are on their way, and one that fails stays in view, marked.
   */
  const uploadFiles = useCallback(
    async (chosen: File[]) => {
      // Storage refuses a file over its size only once it has started to
      // arrive, and says so in bytes; the same limit is checked here first,
      // and said plainly.
      const files = chosen.filter(file => {
        const limit = maxSizeForPathname('attachment', file.name);
        if (file.size <= limit) return true;
        toast.error(
          `${file.name} is larger than ${limit / 1024 / 1024} MB, the most one file can be`
        );
        return false;
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

      // A document is stored under the type its extension says, not the one
      // the browser guessed.
      const typed = files.map(file => {
        const type = documentMediaTypeOf(file.name);
        return type && type !== file.type
          ? new File([file], file.name, { type })
          : file;
      });

      const pending: PendingUpload[] = typed.map(file => ({
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
        typed.map(async (file, index) => {
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
    [occupied, limitMessage, setAttachments, setUploads, user?.id]
  );

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      // Reset first: picking the same file twice in a row fires no change event
      // otherwise, so a removed-then-re-added attachment would look ignored.
      e.target.value = '';
      await uploadFiles(files);
    },
    [uploadFiles]
  );

  const handleScreenshot = useCallback(async () => {
    // Checked before the capture, not after: asking for a screen to share
    // and then turning the picture away wastes the user's choice.
    if (occupied >= MAX_ATTACHMENTS) {
      toast.error(limitMessage);
      return;
    }
    try {
      const file = await captureScreenshot();
      if (file) await uploadFiles([file]);
    } catch (error) {
      console.error('Screenshot error: ', error);
      toast.error('Could not take a screenshot');
    }
  }, [occupied, limitMessage, uploadFiles]);

  const accept = [
    ...(canAttachImages ? IMAGE_TYPES : []),
    ...(canAttachAudio ? AUDIO_TYPES : []),
    ...(canAttachVideo ? VIDEO_TYPES : []),
    ...DOCUMENT_TYPES
  ].join(',');
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
