import { Play } from 'lucide-react';

/**
 * A video's play sign, wherever one is shown by its first frame: a faint
 * disc over the middle, as large as the Library's audio cards' play button,
 * and like it a little larger while pointed at — anywhere on the video, since
 * it covers it — and then solid. Only a sign: what it lies in is the control.
 */
export function PlayDisc() {
  return (
    <span className="group/play absolute inset-0 flex items-center justify-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-black/30 text-white/70 transition group-hover/play:scale-105 group-hover/play:bg-black/50 group-hover/play:text-white">
        {/* Nudged right by as much as the triangle's weight sits left. */}
        <Play className="ml-0.5 size-7 fill-current" />
      </span>
    </span>
  );
}
