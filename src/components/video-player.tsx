import { MediaLightbox } from '@/components/media-lightbox';
import { PlayDisc } from '@/components/play-disc';

interface VideoPlayerProps {
  src: string;
}

/**
 * A video in a message: its first frame under a play disc, as the Library's
 * video cards show one, with no controls of its own. It plays where a
 * picture opens — large, in the lightbox, with the browser's controls.
 */
export function VideoPlayer({ src }: VideoPlayerProps) {
  return (
    <MediaLightbox
      type="video"
      src={src}
      trigger={
        <button
          type="button"
          aria-label="Play video"
          className="relative block w-full cursor-pointer overflow-hidden rounded-lg border bg-black shadow-sm"
        >
          <video
            src={src}
            preload="metadata"
            muted
            playsInline
            className="w-full"
          />
          <PlayDisc />
        </button>
      }
    />
  );
}
