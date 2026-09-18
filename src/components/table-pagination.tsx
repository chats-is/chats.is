import { useRouter } from '@tanstack/react-router';

import { pageCount as countPages, pageItems } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import { filterSearch } from '@/hooks/use-search-filter';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The pager under a paged table.
 *
 * Purely presentational: it is told which page of how many, and reports a
 * click. Who counted the pages is the caller's business — the console's tables
 * let their table instance do it, a hand-rolled table counts them itself.
 *
 * Where the page is kept decides which export to use. `TablePagination` keeps it
 * in the address, so every item is a real link a reader can open in a new tab or
 * come back to. `LocalTablePagination` keeps it in component state, for a table
 * with no address of its own to write to.
 */
type PagerProps = {
  /** 1-based, as the address spells it. */
  page: number;
  pageCount: number;
  pageSize: number;
  /** Rows matching the filter across every page. */
  total: number;
  onPageChange: (page: number) => void;
};

/** The page in the address: every item carries an href. */
export function TablePagination(props: PagerProps) {
  const router = useRouter();

  // Built the way `Link` builds its own href, so a page link survives a
  // basepath and a non-browser history rather than only working at the root.
  const hrefFor = (target: number) => {
    const next = router.buildLocation({
      to: '.',
      search: filterSearch('page', target, 1)
    });
    return router.history.createHref(next.publicHref) || '/';
  };

  return <Pager {...props} hrefFor={hrefFor} />;
}

/**
 * The page in component state, counted here rather than by a table instance.
 *
 * For a table inside a dialog or a panel, where there is no address to put a
 * page in — so the items are buttons rather than links, and reopening the
 * surface starts at the first page again.
 */
export function LocalTablePagination({
  page,
  pageSize,
  total,
  onPageChange
}: Omit<PagerProps, 'pageCount'>) {
  return (
    <Pager
      page={page}
      pageCount={countPages(total, pageSize)}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
    />
  );
}

/**
 * The pager's footprint, before there is a count to page through.
 *
 * The real pager hides itself at a single page, so this is a guess that the
 * table has more than one — but a guess that reserves space is the right way
 * round: the rows land in place instead of the page growing under the reader.
 *
 * One row height for both sides, so the count on the left sits on the same
 * line as the buttons on the right rather than riding higher.
 */
export function TablePaginationSkeleton() {
  return (
    <div className="flex h-8 items-center justify-between gap-2">
      <Skeleton className="h-4 w-40 max-w-[35%]" />
      <Skeleton className="h-8 w-64 max-w-[60%] rounded-full" />
    </div>
  );
}

function Pager({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  hrefFor
}: PagerProps & { hrefFor?: (page: number) => string }) {
  // Nothing to page through. The row count is already visible as the rows.
  if (pageCount <= 1) return null;

  // A page past the end — a filter narrowed the table while a later page was
  // open — pages from the last one, so Previous still goes somewhere useful.
  const current = Math.min(page, pageCount);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  /** A link and a click go to the same place; the click keeps it in the app
   *  rather than reloading the route. Without an href there is nothing to
   *  suppress, but the handler is the same. */
  const goTo = (target: number) => (event: React.MouseEvent) => {
    event.preventDefault();
    onPageChange(target);
  };

  /** An `<a>` with no href is not focusable, so a state-backed pager says what
   *  it is instead of looking like a link that goes nowhere. */
  const roleProps = hrefFor
    ? undefined
    : ({ role: 'button', tabIndex: 0 } as const);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        Showing {first} to {last} of {total} items
      </span>
      <Pagination className="mx-0 w-auto justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              size="sm"
              href={hrefFor?.(current - 1)}
              {...roleProps}
              aria-disabled={current <= 1}
              className={cn(
                'rounded-full',
                current <= 1 && 'pointer-events-none opacity-50'
              )}
              onClick={goTo(current - 1)}
            />
          </PaginationItem>
          {pageItems(current, pageCount).map((item, index) =>
            item === 'ellipsis' ? (
              // Index keys: an ellipsis has no identity of its own, and the two
              // of them can never swap places.
              <PaginationItem key={`ellipsis-${index}`}>
                <PaginationEllipsis className="size-8" />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationLink
                  size="icon-sm"
                  className="rounded-full"
                  href={hrefFor?.(item)}
                  {...roleProps}
                  isActive={item === current}
                  onClick={goTo(item)}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationNext
              size="sm"
              href={hrefFor?.(current + 1)}
              {...roleProps}
              aria-disabled={current >= pageCount}
              className={cn(
                'rounded-full',
                current >= pageCount && 'pointer-events-none opacity-50'
              )}
              onClick={goTo(current + 1)}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
