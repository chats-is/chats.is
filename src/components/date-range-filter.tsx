import { useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { type DateRange } from 'react-day-picker';

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

/**
 * The window a report covers, from the address: a chosen range of calendar
 * days when both ends are there, else the last N days ending today.
 */
function useWindowFromSearch() {
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
    const days = search.days ?? DEFAULT_DAYS;
    const start = reportWindowStart(days);
    return { custom: false, start, last: addDays(start, days - 1), days };
  }, [search.days, search.from, search.to]);
}

/**
 * A report window kept in the address — the overview's stats and the usage
 * log read theirs the same way. Gives the days it covers, the value for the
 * filter, the exclusive end to query up to, and the setter.
 */
export function useReportWindow() {
  const navigate = useNavigate();
  const window = useWindowFromSearch();

  const value: DateRangeValue = window.custom
    ? { from: window.start, to: window.last }
    : { days: window.days };
  // A chosen range ends at the close of its last day; a preset runs to now.
  const until = window.custom ? addDays(window.last, 1) : undefined;

  // One entry per choice, so the back button undoes it. Either kind of
  // window replaces the other, the default leaves the address clean, and a
  // paged table starts over at its first page.
  const setWindow = (next: DateRangeValue) =>
    void navigate({
      to: '.',
      search: (previous: Record<string, unknown>) => {
        const { days: _d, from: _f, to: _t, page: _p, ...rest } = previous;
        if (!('days' in next)) {
          return {
            ...rest,
            from: format(next.from, 'yyyy-MM-dd'),
            to: format(next.to, 'yyyy-MM-dd')
          };
        }
        return next.days === DEFAULT_DAYS ? rest : { ...rest, days: next.days };
      }
    });

  return { window, value, until, setWindow };
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
  onChange
}: {
  value: DateRangeValue;
  /** The first and last day the window covers, for the button and the
   *  calendar to show — a preset's are relative to today. */
  start: Date;
  last: Date;
  onChange: (value: DateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const preset =
    'days' in value ? PRESETS.find(p => p.days === value.days) : undefined;
  // The option marked in the popover: the window in force when it opens, and
  // "custom" as soon as that is chosen — before a range has been picked.
  const [choice, setChoice] = useState<number | 'custom'>('custom');

  const handleOpenChange = (next: boolean) => {
    // Opens on the window in force, so the calendar shows where it is.
    if (next) {
      setDraft({ from: start, to: last });
      setChoice(preset?.days ?? 'custom');
    }
    setOpen(next);
  };

  const choose = (next: DateRangeValue) => {
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
          {preset
            ? preset.label
            : start.getTime() === last.getTime()
              ? format(start, 'LLL d, y')
              : `${format(start, 'LLL d, y')} – ${format(last, 'LLL d, y')}`}
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
          defaultMonth={new Date(last.getFullYear(), last.getMonth() - 1)}
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
