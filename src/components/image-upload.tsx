import { useState } from 'react';
import { XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { uploadFile } from '@/lib/api';
import { UPLOAD_CONFIG } from '@/lib/constant';
import { type UploadType } from '@/lib/upload-config';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Label } from '@/components/ui/label';
import { UploadButton } from '@/components/upload-button';

/**
 * One image, uploaded the moment it is picked: a button to pick it with, or
 * the image with a button at its corner to take it off. `type` says where it
 * is stored, and so which images it takes and how large (`UPLOAD_CONFIG`).
 * Taking it off only empties the value: the stored file stays for whatever
 * still points at it, such as a record not yet saved without it.
 * `onUploadingChange` says while one is on its way, for a form that waits.
 */
export function ImageUpload({
  type,
  value,
  onChange,
  label,
  hint,
  onUploadingChange,
  disabled
}: {
  type: UploadType;
  value: string;
  /** The uploaded image's address; empty when it is taken off. */
  onChange: (url: string) => void;
  label?: string;
  hint?: string;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const { user } = useCurrentUser();
  const [uploading, setUploading] = useState(false);
  const { allowedTypes, maxSize } = UPLOAD_CONFIG[type];
  const accepted = allowedTypes.filter(contentType =>
    contentType.startsWith('image/')
  );

  const upload = async (file: File) => {
    if (!accepted.some(contentType => contentType === file.type)) {
      toast.error(`${file.name} is not an image that can be used here`);
      return;
    }
    if (file.size > maxSize) {
      toast.error(`Image must be ${maxSize / 1024 / 1024}MB or smaller`);
      return;
    }
    if (!user?.id) {
      toast.error('Please sign in again to upload');
      return;
    }

    setUploading(true);
    onUploadingChange?.(true);
    try {
      const result = await uploadFile(file, { userId: user.id, type });
      if ('error' in result) {
        toast.error(result.error || 'Upload failed');
        return;
      }
      onChange(result.url);
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      {/* Room for the remove button that stands out past the tile's
          corner. */}
      <div className="flex pt-1.5">
        {value ? (
          <div className="relative">
            <div className="size-11 overflow-hidden rounded-lg border p-px sm:size-16">
              <img
                src={value}
                alt=""
                className="size-full rounded-md object-cover"
              />
            </div>
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => onChange('')}
              disabled={disabled}
              className="group absolute -top-1.5 -right-1.5 size-5"
            >
              <XCircle className="size-5 rounded-full bg-background text-muted-foreground group-hover:bg-red-400 group-hover:text-white group-disabled:pointer-events-none group-disabled:opacity-80" />
            </button>
          </div>
        ) : (
          <UploadButton
            accept={accepted.join(',')}
            onFiles={([file]) => void upload(file)}
            uploading={uploading}
            disabled={disabled}
          />
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
