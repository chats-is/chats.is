import { type RowData } from '@tanstack/react-table';

import { DEFAULT_PAGE_SIZE } from '@/types/pagination';
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
import {
  CELL_WIDTHS,
  DataTable,
  type ConsoleColumns
} from '@/components/console/data-table';
import { TablePaginationSkeleton } from '@/components/table-pagination';
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
 * The search-and-action row above a console table.
 *
 * Its shape differs page by page and there is no way to read it from the page
 * that has not mounted yet, so each page states it: `search` for the box it
 * opens with — Plans and Quotas have none — `filters` for the selects beside
 * it, and `action` for what closes the row on the right, a button on most
 * pages and a line of counts on Users. A toolbar that stands in with more
 * controls than the page has is a toolbar that moves when the page arrives.
 */
function ToolbarSkeleton({
  search,
  filters,
  action
}: {
  search: boolean;
  filters: number;
  action: ToolbarAction;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex max-w-2xl flex-1 items-center gap-2">
        {search && <Skeleton className="h-9 w-full max-w-xs" />}
        {Array.from({ length: filters }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-40 shrink-0" />
        ))}
      </div>
      {action === 'button' ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <Skeleton className="h-4 w-44" />
      )}
    </div>
  );
}

/** What sits at the right end of a console toolbar. */
type ToolbarAction = 'button' | 'text';

/**
 * A console table, waiting for its first page.
 *
 * Hand it the page's own column defs and only the rows stand in: the header is
 * the real one, rendered by the real `DataTable` with no data to put under it.
 * Nothing is written twice, so a renamed column cannot end up saying one thing
 * on the page and another in its placeholder.
 *
 * `columns` as a number is the fallback, for the log tables whose defs are
 * built inside the component that owns them and so are not reachable from a
 * route's pending component. That outline has to be kept in step by hand.
 *
 * `rows` defaults to a full page, so the table is the height it will be.
 */
export function ConsoleTableSkeleton<TData extends RowData>({
  columns = 5,
  rows = DEFAULT_PAGE_SIZE,
  toolbar = true,
  search = true,
  filters = 0,
  action = 'button',
  pager = true
}: {
  /** The page's real columns, or just how many to hold space for. */
  columns?: number | ConsoleColumns<TData>;
  rows?: number;
  /** Off for a table with no toolbar of its own, such as a log inside a card. */
  toolbar?: boolean;
  /** Whether the toolbar opens with a search box. */
  search?: boolean;
  /** Selects the page carries beside its search box. */
  filters?: number;
  /** What closes the toolbar on the right. */
  action?: ToolbarAction;
  pager?: boolean;
}) {
  return (
    <div className="space-y-6">
      {toolbar && (
        <ToolbarSkeleton search={search} filters={filters} action={action} />
      )}
      <div className="space-y-3">
        {typeof columns === 'number' ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  {Array.from({ length: columns }).map((_, i) => (
                    <TableHead key={i} className="h-auto p-3">
                      <Skeleton className="h-4 w-full max-w-16" />
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
                          className={`h-4 w-full ${CELL_WIDTHS[(row + col) % CELL_WIDTHS.length]}`}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={undefined}
            empty={null}
            pendingRows={rows}
          />
        )}
        {pager && <TablePaginationSkeleton />}
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
 * Usage: the stat cards and charts, then the log beneath them.
 *
 * `columns` because the two pages that use this have logs of different widths —
 * the platform-wide log carries a User column the single-user one does not.
 */
export function ConsoleUsageSkeleton({ columns = 6 }: { columns?: number }) {
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
            <ConsoleTableSkeleton columns={columns} toolbar={false} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
