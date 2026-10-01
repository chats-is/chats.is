import { formatDate, formatMoment } from '@/lib/format-date';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * An instant, in the reader's own time zone: a moment to the second, or
 * the day it falls on.
 *
 * Only the browser knows the reader's time zone. The server renders the
 * page in its own, so it leaves the text out and the browser fills it in
 * once it has taken the page over — rather than the two writing different
 * times into the same place.
 */
export function LocalTime({
  value,
  precision = 'moment'
}: {
  value: Date | string;
  /** `moment`: to the second. `day`: the day, for a date a bill falls on. */
  precision?: 'moment' | 'day';
}) {
  const hydrated = useHydrated();
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {hydrated
        ? precision === 'day'
          ? formatDate(date)
          : formatMoment(date)
        : null}
    </time>
  );
}
