import { useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * The record a console edit form is filled from, read when the form opens.
 *
 * A table is drawn from what was held and brought up to date behind the page.
 * That is right for looking at it and wrong for editing: a form filled from a
 * row shown a while ago is a form about to write that row's past back over
 * its present. So the form opens at once on the row as shown, held so nothing
 * can be typed, and the record is read; the form is filled again when it
 * lands and let go, and the save then means what a save means — this is what
 * the record is now.
 *
 * `load` resolves to the record, or to nothing when there is nothing to fill
 * the form from. Gone, or the read failed: it says so and calls `onMissing`,
 * whose job is to close the dialog. Overtaken — the dialog was closed or
 * pointed at another record while the read was out — it is simply dropped,
 * rather than filling, or closing, a form that is no longer its own.
 */
export function useEditRecord<T>(
  read: (id: string) => Promise<T | null | undefined>,
  what: string,
  onMissing: () => void
) {
  const [isLoading, setIsLoading] = useState(false);
  // Which opening a read belongs to; a read whose number has moved on is not
  // the current one.
  const opening = useRef(0);

  const load = async (id: string): Promise<T | undefined> => {
    const mine = ++opening.current;
    setIsLoading(true);

    try {
      const record = await read(id);
      if (mine !== opening.current) return undefined;
      if (!record) {
        toast.error(`This ${what} no longer exists.`);
        onMissing();
        return undefined;
      }
      return record;
    } catch (error) {
      if (mine !== opening.current) return undefined;
      toast.error((error as Error).message);
      onMissing();
      return undefined;
    } finally {
      if (mine === opening.current) setIsLoading(false);
    }
  };

  /** Called when the dialog closes: a read still out is no longer wanted. */
  const cancel = () => {
    opening.current += 1;
    setIsLoading(false);
  };

  return { load, cancel, isLoading };
}
