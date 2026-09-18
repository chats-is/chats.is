import { z } from 'zod';

/**
 * Paging, as every console table asks for it.
 *
 * The console's tables read one page at a time: the filter narrows in SQL, the
 * count comes back with the rows, and the browser never holds more than a page.
 * `paginationSchema` validates what a server function accepts; what it returns
 * is `{ rows, total, page, pageSize }`, spelled out at each one so the row type
 * stays inferred rather than named.
 */

/** One page size for the whole console, tables and logs alike. */
export const DEFAULT_PAGE_SIZE = 10;

/** `page` is 1-based, so an absent page and `?page=1` mean the same view. */
export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(DEFAULT_PAGE_SIZE)
});

/**
 * The page a console table's address names.
 *
 * Coerced, because a search param arrives as a string, and optional because the
 * first page is spelled by leaving it out — so `?page=1` is a URL the console
 * never produces.
 */
export const pageSearchSchema = z.coerce.number().int().positive().optional();

/** The SQL window a page request names. */
export function pageWindow(input: z.infer<typeof paginationSchema>) {
  return { limit: input.pageSize, offset: (input.page - 1) * input.pageSize };
}
