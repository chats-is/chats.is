import { Loader2 } from 'lucide-react';

import { Switch } from '@/components/ui/switch';

/**
 * A row's on/off switch in a console list. While its change is on the way
 * a spinner stands in its place, at the switch's size so the row does not
 * move, and there is nothing to press a second time.
 */
export function EnabledSwitch({
  checked,
  pending,
  onCheckedChange,
  label
}: {
  checked: boolean;
  /** The change is still being written, or the list not yet read back. */
  pending: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}) {
  if (pending) {
    return (
      <span className="inline-flex h-[1.15rem] w-8 items-center justify-center align-middle">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </span>
    );
  }
  return (
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="align-middle"
    />
  );
}
