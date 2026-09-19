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

const FLAG_TONE: Record<RowState, string> = {
  set: '',
  unset: 'text-muted-foreground',
  stale: 'text-amber-700 dark:text-amber-400'
};

export function SettingsRow({
  icon: Icon,
  label,
  htmlFor,
  hint,
  settingKey,
  state = 'set',
  flag,
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
  /** A line under the control saying what the row's state means. */
  flag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_17rem] sm:gap-x-6',
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

      <div className="flex w-full min-w-0 flex-col items-stretch gap-1.5 sm:items-end sm:justify-self-end">
        {children}
        {flag && (
          // `flex`, not `inline-flex`: an inline box is as wide as its longest
          // line wants to be, and a sentence longer than the column would push
          // the page sideways rather than wrap inside it.
          <span
            className={cn(
              'flex max-w-full items-start gap-1.5 text-xs font-medium sm:text-right',
              FLAG_TONE[state]
            )}
          >
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-current" />
            <span className="min-w-0">{flag}</span>
          </span>
        )}
      </div>
    </div>
  );
}
