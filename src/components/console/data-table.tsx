import {
  createTableHook,
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
import { CELL_WIDTHS } from '@/components/console/skeletons';

/**
 * The console's tables.
 *
 * Every one of them is the same shape — a header row, a row per record, and a
 * message when there are none — so the markup lives here once and each page
 * contributes only its column definitions.
 */

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
 * Registered once for the whole console. Only the core row model is on: these
 * tables sort and filter on the server, or not at all. Adding a feature here —
 * sorting, pagination — turns it on for every console table at once.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the assertion IS the declaration: it is how a feature set names its column-meta type.
const features = tableFeatures({ columnMeta: {} as ConsoleColumnMeta });

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

export function DataTable<TData extends RowData>({
  columns,
  data,
  empty,
  pendingRows = 5,
  dense,
  className,
  tableClassName
}: {
  columns: ConsoleColumns<TData>;
  /** Undefined while the query is in flight — the rows stand in until it lands. */
  data: Array<TData> | undefined;
  /** Shown in place of the rows when the table has loaded and holds none. */
  empty: React.ReactNode;
  /** How many rows to stand in with while `data` is undefined. */
  pendingRows?: number;
  /** Tighter padding, for the log tables that sit inside a card. */
  dense?: boolean;
  className?: string;
  tableClassName?: string;
}) {
  const table = useAppTable({ columns, data: data ?? NO_ROWS });
  const rows = table.getRowModel().rows;

  return (
    <div className={cn('rounded-md border', className)}>
      <Table className={tableClassName}>
        <TableHeader>
          {table.getHeaderGroups().map(group => (
            <TableRow key={group.id} className="bg-muted/50 hover:bg-muted/50">
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
            Array.from({ length: pendingRows }).map((_, row) => (
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
                      className={`h-4 ${CELL_WIDTHS[(row + col) % CELL_WIDTHS.length]}`}
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
  );
}
