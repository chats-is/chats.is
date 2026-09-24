import { UPLOAD_CONFIG } from '@/lib/upload-config';

/** Whether this browser can capture the screen — desktop ones can, phones
 *  and some embedded views cannot. */
export function canCaptureScreen(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  );
}

/**
 * Ask the user for a screen, window or tab, and take one frame of it as an
 * image file. Resolves to null when they decline the prompt.
 *
 * The capture is stopped as soon as the frame is taken: the browser shows the
 * screen as being shared for as long as a track is live, and a screenshot is
 * a moment, not a session.
 */
export async function captureScreenshot(): Promise<File | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
  } catch (err) {
    // Cancelling the browser's picker is an answer, not a failure.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return null;
    }
    throw err;
  }

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise(resolve =>
        video.addEventListener('resize', resolve, { once: true })
      );
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.drawImage(video, 0, 0);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // PNG keeps text sharp; a busy screen at a large size can outgrow what an
    // attachment may weigh, and then it goes as a JPEG rather than not at all.
    const png = await toBlob(canvas, 'image/png');
    if (png.size <= UPLOAD_CONFIG.attachment.maxSize) {
      return new File([png], `screenshot-${stamp}.png`, { type: 'image/png' });
    }
    const jpeg = await toBlob(canvas, 'image/jpeg', 0.9);
    return new File([jpeg], `screenshot-${stamp}.jpg`, { type: 'image/jpeg' });
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      blob =>
        blob ? resolve(blob) : reject(new Error('Could not encode the image')),
      type,
      quality
    )
  );
}
