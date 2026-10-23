import { useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { type DateRange } from 'react-day-picker';

import { formatDate } from '@/lib/format-date';
import { cn, reportWindowStart } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';

/** A report window as it is chosen: a preset of the last N days ending
 *  today, or a range of local calendar days, both ends included. */
export type DateRangeValue = { days: number } | { from: Date; to: Date };

const PRESETS = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' }
];

const DEFAULT_DAYS = 7;

/** `'YYYY-MM-DD'` → local midnight of that day. */
const parseDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (date: Date, n: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

type ReportWindow = {
  custom: boolean;
  start: Date;
  last: Date;
  days: number;
};

/**
 * The window a report covers, from the address: a chosen range of calendar
 * days when both ends are there, else the last N days ending today. Where
 * none has to be chosen, an address without one is no window at all.
 */
function useWindowFromSearch(optional: boolean): ReportWindow | null {
  const search: { days?: number; from?: string; to?: string } = useSearch({
    strict: false
  });
  return useMemo(() => {
    if (search.from && search.to) {
      const start = parseDay(search.from);
      const last = parseDay(search.to);
      const days = Math.round((last.getTime() - start.getTime()) / 864e5) + 1;
      return { custom: true, start, last, days };
    }
    if (optional && search.days === undefined) return null;
    const days = search.days ?? DEFAULT_DAYS;
    const start = reportWindowStart(days);
    return { custom: false, start, last: addDays(start, days - 1), days };
  }, [optional, search.days, search.from, search.to]);
}

type OptionalReportWindowState = {
  window: ReportWindow | null;
  value: DateRangeValue | null;
  until: Date | undefined;
  /** Whether the report goes by the hour: a window of one day, which as
   *  days would be a single point. */
  hourly: boolean;
  /** Where each of a chart's points begins: each day of the window, or each
   *  hour of its one day — up to now, where that day is today. */
  points: Date[];
  /** A window, or null for none — the page's default. */
  setWindow: (next: DateRangeValue | null) => void;
};

type ReportWindowState = OptionalReportWindowState & {
  window: ReportWindow;
  value: DateRangeValue;
};

/**
 * A report window kept in the address — the Overview, Usage, Revenue, the
 * Logs and a user's page read theirs the same way. Gives the days it
 * covers, the value for the filter, the exclusive end to query up to, and
 * the setter.
 *
 * A report always covers a window, the last seven days unless another is
 * chosen. With `optional`, as the Logs has it, none is chosen until one is,
 * and every day is covered.
 */
export function useReportWindow(): ReportWindowState;
export function useReportWindow(options: {
  optional: true;
}): OptionalReportWindowState;
export function useReportWindow({
  optional = false
}: { optional?: boolean } = {}): OptionalReportWindowState {
  const navigate = useNavigate();
  const window = useWindowFromSearch(optional);

  const value: DateRangeValue | null = !window
    ? null
    : window.custom
      ? { from: window.start, to: window.last }
      : { days: window.days };
  // A chosen range ends at the close of its last day; a preset runs to now.
  const until = window?.custom ? addDays(window.last, 1) : undefined;
  const hourly = window?.days === 1;
  const points = !window
    ? []
    : hourly
      ? hoursOf(window.start)
      : Array.from({ length: window.days }, (_, i) => addDays(window.start, i));

  // One entry per choice, so the back button undoes it. Either kind of
  // window replaces the other, the default leaves the address clean, and a
  // paged table starts over at its first page. Where no window is the
  // default, every preset is written out, since its absence means none.
  const setWindow = (next: DateRangeValue | null) =>
    void navigate({
      to: '.',
      search: (previous: Record<string, unknown>) => {
        const { days: _d, from: _f, to: _t, page: _p, ...rest } = previous;
        if (!next) return rest;
        if (!('days' in next)) {
          return {
            ...rest,
            from: format(next.from, 'yyyy-MM-dd'),
            to: format(next.to, 'yyyy-MM-dd')
          };
        }
        return next.days === DEFAULT_DAYS && !optional
          ? rest
          : { ...rest, days: next.days };
      }
    });

  return { window, value, until, hourly, points, setWindow };
}

/**
 * Each hour of a day from its midnight, every 3,600 seconds as the server
 * counts them — so a day the clocks change on has the 23 or 25 it had — and
 * no further than now, where the day is today.
 */
function hoursOf(start: Date): Date[] {
  const end = Math.min(addDays(start, 1).getTime(), Date.now());
  const hours: Date[] = [];
  for (let at = start.getTime(); at < end; at += 60 * 60 * 1000) {
    hours.push(new Date(at));
  }
  return hours;
}

/**
 * One control for a report window: the button names it, and opens the
 * presets and a custom range beside a two-month calendar. A preset applies at once; on the
 * calendar the first click starts a new range — never stretching the one it
 * opened on — and the second closes it, in either order, the same day twice
 * being a one-day range.
 */
export function DateRangeFilter({
  value,
  start,
  last,
  optional = false,
  onChange
}: {
  /** The window in force; null for none, where none has to be chosen. */
  value: DateRangeValue | null;
  /** The first and last day the window covers, for the button and the
   *  calendar to show — a preset's are relative to today. */
  start?: Date;
  last?: Date;
  /** Offers "All time", for a page that needs no window to show anything. */
  optional?: boolean;
  onChange: (value: DateRangeValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const preset =
    value && 'days' in value
      ? PRESETS.find(p => p.days === value.days)
      : undefined;
  // The option marked in the popover: the window in force when it opens, and
  // "custom" as soon as that is chosen — before a range has been picked.
  const [choice, setChoice] = useState<number | 'custom' | 'all'>('custom');

  const handleOpenChange = (next: boolean) => {
    // Opens on the window in force, so the calendar shows where it is.
    if (next) {
      setDraft(start && last ? { from: start, to: last } : undefined);
      setChoice(value === null ? 'all' : (preset?.days ?? 'custom'));
    }
    setOpen(next);
  };

  // The calendar opens on the window's months, or on this one.
  const anchor = last ?? new Date();

  const choose = (next: DateRangeValue | null) => {
    onChange(next);
    setOpen(false);
  };

  const handleDayClick = (day: Date) => {
    setChoice('custom');
    if (!draft?.from || draft.to) {
      setDraft({ from: day, to: undefined });
      return;
    }
    const [from, to] = day < draft.from ? [day, draft.from] : [draft.from, day];
    choose({ from, to });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-start font-normal">
          <CalendarIcon className="size-4 text-muted-foreground" />
          {!value || !start || !last
            ? 'All time'
            : preset
              ? preset.label
              : start.getTime() === last.getTime()
                ? formatDate(start)
                : `${formatDate(start)} – ${formatDate(last)}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-auto p-0"
        align="start"
        // Focus would ring the first option, and read as a second choice
        // beside the one that is marked.
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <div className="flex w-36 flex-col gap-1 border-r p-2">
          {optional && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'justify-start font-normal',
                choice === 'all' && 'bg-accent'
              )}
              onClick={() => choose(null)}
            >
              All time
            </Button>
          )}
          {PRESETS.map(p => (
            <Button
              key={p.days}
              variant="ghost"
              size="sm"
              className={cn(
                'justify-start font-normal',
                choice === p.days && 'bg-accent'
              )}
              onClick={() => choose({ days: p.days })}
            >
              {p.label}
            </Button>
          ))}
          {/* Stays open: it clears the calendar for a new range to be picked
              on it, and marks the window when that is what is in force. */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'justify-start font-normal',
              choice === 'custom' && 'bg-accent'
            )}
            onClick={() => {
              setChoice('custom');
              setDraft(undefined);
            }}
          >
            Custom range
          </Button>
        </div>
        <Calendar
          mode="range"
          // Two months ending on the window's last, and none past this one —
          // the future has nothing to show.
          defaultMonth={new Date(anchor.getFullYear(), anchor.getMonth() - 1)}
          endMonth={new Date()}
          selected={draft}
          onSelect={(_, day) => handleDayClick(day)}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
        />
      </PopoverContent>
    </Popover>
  );
}
