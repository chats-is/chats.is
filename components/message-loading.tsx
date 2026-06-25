import { IconLoading } from '@/components/ui/icons';
import { ModelIcon } from '@/components/model-icon';

export interface MessageLoadingProps {
  image?: string | null;
}

export function MessageLoading({ image }: MessageLoadingProps) {
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
          <div className="mr-12">
            <IconLoading className="text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}
