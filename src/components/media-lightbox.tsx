import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

interface MediaLightboxProps {
  type: 'image' | 'video';
  src: string;
  alt?: string;
  /** The clickable element shown inline (image thumbnail or a button). */
  trigger: React.ReactNode;
  className?: string;
}

export function MediaLightbox({
  type,
  src,
  alt,
  trigger,
  className
}: MediaLightboxProps) {
  const title = alt || (type === 'image' ? 'Image preview' : 'Video preview');

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'block w-auto max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[90vw]',
          className
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {type === 'image' ? (
          <img
            src={src}
            alt={title}
            className="mx-auto max-h-[90vh] w-auto max-w-full rounded-lg object-contain"
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            className="mx-auto max-h-[90vh] w-auto max-w-full rounded-lg"
          />
        )}
        <DialogClose className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70 focus:outline-none">
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
