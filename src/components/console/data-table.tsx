import {
  createTableHook,
  rowPaginationFeature,
  tableFeatures,
  type ColumnDef,
  type RowData
} from '@tanstack/react-table';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { TablePagination } from '@/components/table-pagination';

/**
 * The console's tables.
 *
 * Every one of them is the same shape — a header row, a row per record, a
 * message when there are none, and a pager under it — so the markup lives here
 * once and each page contributes only its column definitions.
 */

/**
 * A run of cells of slightly varied width, so a row does not read as a grid.
 * Shared with `ConsoleTableSkeleton`, which stands in the same way before the
 * table is mounted at all.
 *
 * Ceilings rather than widths, and paired with `w-full`. A bar of a fixed width
 * cannot shrink or wrap the way the text it stands in for does, so a wide table
 * of them sets a minimum width the real rows never ask for — and the page
 * scrolls sideways until the data lands and the cells start wrapping.
 */
export const CELL_WIDTHS = [
  'max-w-32',
  'max-w-24',
  'max-w-40',
  'max-w-20',
  'max-w-28',
  'max-w-16'
];

/** Per-column presentation. Read here so a column def carries its own layout. */
export type ConsoleColumnMeta = {
  /** Column alignment. Applies to the header and the body cells alike. */
  align?: 'center' | 'right';
  /** Width or other classes for the header cell. */
  headClassName?: string;
  /** Extra classes for the body cells. */
  cellClassName?: string;
};

/**
 * Registered once for the whole console. Adding a feature here — sorting, say —
 * turns it on for every console table at once.
 *
 * Pagination is on, but `manualPagination` is too: the server has already cut
 * the page, so the table never slices rows and needs no paginated row model.
 * What it owns is the page *state* — which page, how big, how many pages the
 * row count implies — so the pager and the pending rows read one source
 * instead of each doing the arithmetic again.
 */
const features = tableFeatures({
  rowPaginationFeature,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the assertion IS the declaration: it is how a feature set names its column-meta type.
  columnMeta: {} as ConsoleColumnMeta
});

export const { createAppColumnHelper, useAppTable } = createTableHook({
  features
});

/** A column list as `createAppColumnHelper<T>().columns([...])` returns it. */
export type ConsoleColumns<TData extends RowData> = Array<
  ColumnDef<typeof features, TData, any>
>;

/**
 * One shared empty array for every table still loading. A fresh `[]` each
 * render would invalidate the row model on every pass.
 */
const NO_ROWS: Array<never> = [];

const ALIGN = { center: 'text-center', right: 'text-right' } as const;

const alignOf = (meta: ConsoleColumnMeta | undefined) =>
  meta?.align ? ALIGN[meta.align] : undefined;

/** The page a table is showing, as the server cut it. The page *count* is not
 *  here: the table instance derives it from `total` and `pageSize`. */
export type TablePage = {
  /** 1-based, as the address spells it. */
  page: number;
  pageSize: number;
  /** Rows matching the filter across every page. */
  total: number;
  onPageChange: (page: number) => void;
};

export function DataTable<TData extends RowData>({
  columns,
  data,
  empty,
  pendingRows,
  dense,
  pending,
  pagination,
  className,
  tableClassName
}: {
  columns: ConsoleColumns<TData>;
  /** Undefined while the query is in flight — the rows stand in until it lands. */
  data: Array<TData> | undefined;
  /** Shown in place of the rows when the table has loaded and holds none. */
  empty: React.ReactNode;
  /** How many rows to stand in with while `data` is undefined. Defaults to a
   *  full page, so the table does not change height when the rows land. */
  pendingRows?: number;
  /** Tighter padding, for the log tables that sit inside a card. */
  dense?: boolean;
  /** Showing the previous page while the next one is fetched. The rows stay put
   *  — blanking them is what the skeleton is for, on a first load — but they go
   *  quiet and stop taking clicks, so nothing is acted on that is about to be
   *  replaced. */
  pending?: boolean;
  /** The page these rows were cut from. Omitted when the table holds a whole
   *  list the server never pages. */
  pagination?: TablePage;
  className?: string;
  tableClassName?: string;
}) {
  const table = useAppTable({
    columns,
    data: data ?? NO_ROWS,
    // The server cut the page, so the table counts pages rather than slicing
    // rows. `rowCount` is what it counts them from.
    manualPagination: true,
    rowCount: pagination?.total ?? data?.length ?? 0,
    state: {
      pagination: pagination && {
        pageIndex: pagination.page - 1,
        pageSize: pagination.pageSize
      }
    },
    onPaginationChange: updater => {
      if (!pagination) return;
      const previous = {
        pageIndex: pagination.page - 1,
        pageSize: pagination.pageSize
      };
      const next = typeof updater === 'function' ? updater(previous) : updater;
      // The table counts pages from zero; the address counts them from one.
      pagination.onPageChange(next.pageIndex + 1);
    }
  });
  const rows = table.getRowModel().rows;
  const standInRows =
    pendingRows ?? (pagination ? table.state.pagination.pageSize : 5);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'rounded-md border transition-opacity',
          pending && 'pointer-events-none opacity-60',
          className
        )}
      >
        <Table className={tableClassName}>
          <TableHeader>
            {table.getHeaderGroups().map(group => (
              <TableRow
                key={group.id}
                className="bg-muted/50 hover:bg-muted/50"
              >
                {group.headers.map(header => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'h-auto text-sm font-medium',
                        dense ? 'p-2' : 'p-3',
                        alignOf(meta),
                        meta?.headClassName
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {/* A table with no data yet is a table mid-flight, not an empty one:
              standing in with rows keeps the height and lets the real rows
              arrive in place. */}
            {data === undefined ? (
              Array.from({ length: standInRows }).map((_, row) => (
                <TableRow key={row} className="hover:bg-transparent">
                  {table.getAllLeafColumns().map((column, col) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        'whitespace-normal',
                        dense ? 'p-2' : 'p-3',
                        alignOf(column.columnDef.meta),
                        column.columnDef.meta?.cellClassName
                      )}
                    >
                      <Skeleton
                        className={`h-4 w-full ${CELL_WIDTHS[(row + col) % CELL_WIDTHS.length]}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={table.getAllLeafColumns().length}
                  className="p-6 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow key={row.id} className="hover:bg-muted/30">
                  {row.getAllCells().map(cell => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'whitespace-normal',
                          dense ? 'p-2' : 'p-3',
                          alignOf(meta),
                          meta?.cellClassName
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && (
        <TablePagination
          page={table.state.pagination.pageIndex + 1}
          pageCount={table.getPageCount()}
          pageSize={table.state.pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.onPageChange}
        />
      )}
    </div>
  );
}
