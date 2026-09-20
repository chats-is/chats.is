import { cn } from '@/lib/utils';

/**
 * A settings page as a list rather than a grid of fields.
 *
 * The console's settings are read down — an admin comes here to see what this
 * installation falls back on, and only then to change one — so each setting
 * gets a row of its own: what it is on the left, the control on the right, and
 * every control ending on the same edge so the column can be scanned.
 */

export function SettingsList({
  title,
  aside,
  children
}: {
  title: React.ReactNode;
  /** Shown at the right of the heading, for a tally or a count. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b bg-muted px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

/** How a row reads at a glance. `stale` is a value naming something that is
 *  no longer on offer. */
export type RowState = 'set' | 'unset' | 'stale';

const ROW_TINT: Record<RowState, string> = {
  set: '',
  unset: 'bg-muted/40',
  stale: 'bg-amber-50 dark:bg-amber-950/25'
};

export function SettingsRow({
  icon: Icon,
  label,
  htmlFor,
  hint,
  settingKey,
  state = 'set',
  children
}: {
  /** Widened from lucide's own type so the pending page can stand one in. */
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  /** Omitted for a row whose control labels itself, such as a switch. */
  htmlFor?: string;
  hint?: React.ReactNode;
  /** The key this row writes, for whoever is reading the database. */
  settingKey: React.ReactNode;
  state?: RowState;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6',
        ROW_TINT[state]
      )}
    >
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="font-medium">
              {label}
            </label>
          ) : (
            <div className="font-medium">{label}</div>
          )}
          {hint && (
            <div className="mt-0.5 max-w-[60ch] text-sm text-muted-foreground">
              {hint}
            </div>
          )}
          <div className="mt-1 font-mono text-[11px] text-muted-foreground/75">
            {settingKey}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 justify-end sm:justify-self-end">
        {children}
      </div>
    </div>
  );
}
