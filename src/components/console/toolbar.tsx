import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';

/**
 * The row above a console table.
 *
 * Every page had been writing its own version of this, and they had drifted —
 * one wrapped, one right-aligned because it has no filters, the rest each a
 * near-copy. One layout here instead, so the search box starts at the same
 * place and the action ends at the same place on every page in the console.
 *
 * Takes the filter group and the page's action as its two children, in that
 * order. The action is usually a dialog trigger, sometimes a line of text.
 */
export function ConsoleToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {children}
    </div>
  );
}

/**
 * The filters at the left of a toolbar.
 *
 * Holds its width even with nothing in it, so a page with no filters still puts
 * its action where every other page puts one.
 */
export function ConsoleFilters({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-1 items-center gap-2">{children}</div>
  );
}

/** The search box a console toolbar opens with. */
export function ConsoleSearch({
  placeholder,
  value,
  onChange
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative max-w-xs flex-1">
      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="pl-9"
      />
    </div>
  );
}
