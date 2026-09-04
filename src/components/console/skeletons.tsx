import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { UsageModuleSkeleton } from '@/components/usage-module';

/**
 * What a console page shows before its data arrives.
 *
 * Each of these traces the page it stands in for, so the placeholder occupies
 * the space the real content will and nothing moves when it arrives. A route's
 * pending component and its component's own loading state share one of these,
 * so the two can never show a different shape for the same wait.
 */

/**
 * A run of cells of slightly varied width, so a row does not read as a grid.
 * Shared with `DataTable`, which stands in the same way once it is mounted.
 */
export const CELL_WIDTHS = ['w-32', 'w-24', 'w-40', 'w-20', 'w-28', 'w-16'];

/** The search-and-action row most console pages carry above their table. */
function ToolbarSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4">
      <Skeleton className="h-9 w-full max-w-xs" />
      <Skeleton className="h-9 w-28" />
    </div>
  );
}

/**
 * A console table, in outline. `columns` and `rows` are the shape to hold, not
 * a promise about the data — a page whose table is a different width simply
 * settles into place when it arrives.
 */
export function ConsoleTableSkeleton({
  columns = 5,
  rows = 6,
  toolbar = true
}: {
  columns?: number;
  rows?: number;
  toolbar?: boolean;
}) {
  return (
    <div className="space-y-6">
      {toolbar && <ToolbarSkeleton />}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={i} className="h-auto p-3">
                  <Skeleton className="h-4 w-16" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, row) => (
              <TableRow key={row} className="hover:bg-transparent">
                {Array.from({ length: columns }).map((_, col) => (
                  <TableCell key={col} className="p-3">
                    <Skeleton
                      className={`h-4 ${CELL_WIDTHS[(row + col) % CELL_WIDTHS.length]}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** The console home, whose page is a grid of counts. */
export function ConsoleCardsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="size-4 rounded" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * The settings panel the nav switches between — a run of labelled fields. The
 * nav itself is a static list, so the route shows the real one and only the
 * panel stands in.
 */
export function ConsoleSettingsPanelSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Usage: the stat cards and charts, then the log beneath them. */
export function ConsoleUsageSkeleton() {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-12" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="size-9" />
          </div>
        </div>
        <UsageModuleSkeleton isAdmin />
        <Card className="py-0">
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-5 w-16" />
            <ConsoleTableSkeleton columns={6} rows={5} toolbar={false} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
