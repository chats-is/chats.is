import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { type DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
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
