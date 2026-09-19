import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import { SettingsList, SettingsRow } from './list';

/**
 * What each settings page shows before its values arrive.
 *
 * Built out of the same `SettingsList` and `SettingsRow` the pages themselves
 * use, with a bar standing in for each piece of content. A placeholder made of
 * its own markup drifts the moment a row grows a line; this one cannot, and it
 * is the height the page will be, so nothing moves when the values land.
 */

/** Stands in for a row's icon, in the space the real one occupies. */
function IconStandIn({ className }: { className?: string }) {
  return <Skeleton className={cn('rounded', className)} />;
}

/** Whatever the row turns out to be: a label, a line about it, its key, and a
 *  control the width of the column. */
function PendingRow({ hint = true }: { hint?: boolean }) {
  return (
    <SettingsRow
      icon={IconStandIn}
      label={<Skeleton className="h-4 w-44 max-w-full" />}
      hint={hint ? <Skeleton className="h-3.5 w-80 max-w-full" /> : undefined}
      settingKey={<Skeleton className="h-2.5 w-36 max-w-full" />}
    >
      <Skeleton className="h-9 w-full" />
    </SettingsRow>
  );
}

/** The heading bar above a block of fields, outside a `SettingsList`. */
function PendingHead({ width }: { width: string }) {
  return (
    <div className="border-b bg-muted px-4 py-3">
      <Skeleton className={cn('h-4', width)} />
    </div>
  );
}

function PendingField({
  width,
  control,
  className
}: {
  width: string;
  control: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Skeleton className={cn('h-4', width)} />
      <Skeleton className={cn('w-full', control)} />
    </div>
  );
}

/** Save, which every settings page ends on. */
function PendingSave() {
  return <Skeleton className="h-9 w-32" />;
}

/** General: the application block, then the prompt on its own. */
export function GeneralPending() {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border">
        <PendingHead width="w-24" />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <PendingField width="w-20" control="h-9" />
          <PendingField width="w-24" control="h-9" />
          {/* A textarea sizes to what it holds, so an empty one sits at its
              floor — which is where an unset setting starts. */}
          <PendingField width="w-28" control="h-16" className="md:col-span-2" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <PendingHead width="w-52" />
        <div className="p-4">
          <Skeleton className="h-32 w-full" />
        </div>
      </div>

      <PendingSave />
    </div>
  );
}

/** Defaults: nine model rows, then the two settings that are not model picks. */
export function DefaultsPending() {
  return (
    <div className="space-y-6">
      <SettingsList title={<Skeleton className="h-4 w-32" />}>
        {Array.from({ length: 9 }).map((_, row) => (
          <PendingRow key={row} />
        ))}
      </SettingsList>

      <SettingsList title={<Skeleton className="h-4 w-44" />}>
        <PendingRow />
      </SettingsList>

      <SettingsList title={<Skeleton className="h-4 w-28" />}>
        <PendingRow />
      </SettingsList>

      <PendingSave />
    </div>
  );
}
