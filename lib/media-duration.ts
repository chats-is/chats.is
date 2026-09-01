import 'server-only';

import { parseBuffer } from 'music-metadata';

/**
 * How long a piece of audio runs, read from the file itself.
 *
 * Transcription bills per second, and whether a provider reports the length it
 * processed is up to that provider: some do, some do not. The bytes were
 * downloaded to be transcribed either way, so the length is measured from the
 * file rather than depending on what any particular model chose to send back.
 *
 * Returns undefined when the format cannot be read; the caller decides what
 * an unmeasurable length means for it.
 */
export async function audioDurationInSeconds(
  data: Uint8Array,
  mediaType?: string
): Promise<number | undefined> {
  try {
    const metadata = await parseBuffer(
      data,
      mediaType ? { mimeType: mediaType } : undefined,
      { duration: true }
    );
    const seconds = metadata.format.duration;
    return typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds > 0
      ? seconds
      : undefined;
  } catch (err) {
    console.warn('[media-duration] could not read audio duration:', err);
    return undefined;
  }
}
