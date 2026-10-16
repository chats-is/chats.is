import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUp, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SelectionEditProps {
  /** The source view, scrolled within itself, that a passage is selected
   *  in; the button is placed inside it, below the passage. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Sends the request about the passage. */
  onSubmit: (selection: string, request: string) => void;
}

interface Selected {
  text: string;
  top: number;
  left: number;
}

// The widest the request's box grows, and its margin from the view's edges.
const BOX_WIDTH = 384;
const EDGE = 8;

/**
 * A passage selected in an artifact's source, and what the reader asks about
 * it: an Edit button below the passage, which opens a box for the request.
 *
 * Code is drawn by CodeMirror, which draws only the lines on screen, so the
 * passage is read from its own selection, not the page's; the plain text of
 * a document is read from the page's.
 */
export function SelectionEdit({ containerRef, onSubmit }: SelectionEditProps) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  // Held once the box is open: typing in it moves the page's selection.
  const openRef = useRef(false);
  // Lets go of the passage: once it is asked about, or the box is closed or
  // clicked away from. The editor draws its selection itself, and would
  // keep it shown after the page's had gone.
  const clearRef = useRef<(() => void) | null>(null);
  const showBox = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (!next) setRequest('');
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let dragging = false;
    let frame = 0;

    const read = async () => {
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !container.contains(selection.anchorNode)
      ) {
        clearRef.current = null;
        setSelected(null);
        return;
      }

      let text: string;
      let rect: DOMRect | { bottom: number; left: number } | null;
      let clear: () => void;
      const editor = container.querySelector<HTMLElement>('.cm-editor');
      if (editor?.contains(selection.anchorNode)) {
        // Already loaded with the editor that drew the code.
        const { EditorView } = await import('@codemirror/view');
        const view = EditorView.findFromDOM(editor);
        if (!view) return;
        const { from, to } = view.state.selection.main;
        text = view.state.sliceDoc(from, to);
        // A passage that ends with its line ends on it, not on the next.
        rect = view.coordsAtPos(text.endsWith('\n') ? to - 1 : to);
        clear = () => view.dispatch({ selection: { anchor: to } });
      } else {
        const range = selection.getRangeAt(0);
        text = selection.toString();
        const rects = range.getClientRects();
        rect = rects[rects.length - 1] ?? range.getBoundingClientRect();
        clear = () => selection.removeAllRanges();
      }
      if (openRef.current) return;
      if (!text.trim() || !rect) {
        clearRef.current = null;
        setSelected(null);
        return;
      }
      clearRef.current = clear;

      const bounds = container.getBoundingClientRect();
      const width = Math.min(BOX_WIDTH, container.clientWidth - EDGE * 2);
      setSelected({
        text,
        top: rect.bottom - bounds.top + container.scrollTop + 6,
        left: Math.max(
          EDGE,
          Math.min(
            rect.left - bounds.left + container.scrollLeft,
            container.clientWidth - width - EDGE
          )
        )
      });
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      // After the editor has taken the selection in.
      frame = requestAnimationFrame(() => void read());
    };

    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return;
      if (openRef.current) {
        openRef.current = false;
        setOpen(false);
        setRequest('');
      }
      if (container.contains(event.target as Node)) {
        // Shown once the passage is chosen, not following it as it is.
        dragging = true;
      } else {
        clearRef.current?.();
      }
      clearRef.current = null;
      setSelected(null);
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      schedule();
    };
    const onSelectionChange = () => {
      if (dragging || openRef.current) return;
      schedule();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [containerRef]);

  useEffect(() => {
    if (open) boxRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  if (!selected) return null;

  const close = () => {
    clearRef.current?.();
    clearRef.current = null;
    showBox(false);
    setSelected(null);
  };

  return (
    <div
      ref={boxRef}
      className="absolute z-10"
      style={{
        top: selected.top,
        left: selected.left,
        width: open ? `min(${BOX_WIDTH}px, calc(100% - ${EDGE * 2}px))` : 'auto'
      }}
    >
      {open ? (
        <form
          className="flex items-center gap-1 rounded-full border bg-popover p-1 pl-2 shadow-md"
          onSubmit={event => {
            event.preventDefault();
            if (!request.trim()) return;
            onSubmit(selected.text, request.trim());
            close();
          }}
        >
          <Input
            autoFocus
            value={request}
            onChange={event => setRequest(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') close();
            }}
            placeholder="Ask about or describe a change…"
            className="h-8 border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="submit"
            size="icon"
            className="size-8 shrink-0 rounded-full"
            disabled={!request.trim()}
          >
            <ArrowUp className="size-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full bg-popover px-3 text-xs shadow-sm dark:bg-popover dark:hover:bg-accent"
          // Pressed without taking the focus, which would drop the passage.
          onMouseDown={event => event.preventDefault()}
          onClick={() => showBox(true)}
        >
          <Pencil className="size-3" />
          Edit
        </Button>
      )}
    </div>
  );
}
