import { type ReactNode } from 'react';

import { IconLoading } from '@/components/icons';
import { ModelIcon } from '@/components/model-icon';

export interface MessageLoadingProps {
  image?: string | null;
}

/**
 * Where a reply that is not a message yet is drawn — one still on its way,
 * or one whose request failed before any of it came: beside the model's
 * avatar, as the reply would be.
 */
export function PendingReply({
  image,
  children
}: MessageLoadingProps & { children: ReactNode }) {
  return (
    <div
      tabIndex={0}
      className="group mb-1 rounded-md pb-1 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden"
    >
      <div className="flex items-start">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted select-none">
          <ModelIcon image={image} />
        </div>
        <div className="ml-3 flex min-h-9 flex-1 flex-col items-start justify-center overflow-hidden px-1">
          {children}
        </div>
      </div>
    </div>
  );
}

export function MessageLoading({ image }: MessageLoadingProps) {
  return (
    <PendingReply image={image}>
      <div className="mr-12">
        <IconLoading className="text-muted-foreground" />
      </div>
    </PendingReply>
  );
}
