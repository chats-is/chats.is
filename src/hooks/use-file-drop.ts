import { useEffect, useRef, useState } from 'react';

/**
 * Files dragged onto the window, handed to `onDrop` — anywhere on the page,
 * not only on the composer: the thread and the canvas are where a file is
 * most often let go. Answers whether files are being dragged over it now, and
 * would be taken.
 *
 * Only a drag carrying files counts; text or a link dragged within the page
 * is left to the browser. A drop is always caught, even while one would not
 * be taken: let through, the browser opens the file in place of the chat.
 */
export function useFileDrop(
  onDrop: (files: File[]) => void,
  enabled: boolean
): boolean {
  const [dragging, setDragging] = useState(false);
  // Read when a drop lands, so the listeners need not be replaced as these
  // change.
  const latest = useRef({ onDrop, enabled });
  useEffect(() => {
    latest.current = { onDrop, enabled };
  });

  useEffect(() => {
    // Every element the drag crosses fires its own enter and leave; the drag
    // has left the window only when as many leaves as enters have fired.
    let depth = 0;
    const carriesFiles = (event: DragEvent) =>
      !!event.dataTransfer?.types.includes('Files');

    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = latest.current.enabled
          ? 'copy'
          : 'none';
      }
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (latest.current.enabled) {
        latest.current.onDrop(Array.from(event.dataTransfer?.files ?? []));
      }
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return dragging && enabled;
}
