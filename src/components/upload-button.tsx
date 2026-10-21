import { Loader2, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The button files are picked with: a dashed square with a plus, the size of
 * a file's tile beside it, or a spinner while one is on its way. It only
 * picks them — what becomes of them is the caller's (`onFiles`). For anywhere
 * files are added beside the ones already added, so all of them add a file
 * alike.
 */
export function UploadButton({
  accept,
  multiple,
  onFiles,
  uploading,
  disabled,
  className
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  uploading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground has-disabled:pointer-events-none has-disabled:opacity-50 sm:size-16',
        className
      )}
    >
      {uploading ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <Plus className="size-5" />
      )}
      <span className="sr-only">Add files</span>
      <input
        type="file"
        multiple={multiple}
        className="hidden"
        accept={accept}
        disabled={disabled || uploading}
        onChange={event => {
          const files = Array.from(event.target.files ?? []);
          // Cleared at once, so the same file can be picked again.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}
