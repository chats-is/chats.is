/** A slot in the pager: a page to jump to, or a run of pages skipped over. */
export type PageItem = number | 'ellipsis';

/** How many pages `total` rows fill. At least one, so an empty table still
 *  reads "1 of 1" rather than "of 0". */
export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** How many slots a pager holds once it starts collapsing runs. */
const SLOTS = 7;

/**
 * Which page numbers the pager shows.
 *
 * The first and last page are always reachable, the current page keeps a
 * neighbour each side, and any run skipped between them collapses to a single
 * ellipsis. Every branch fills the same number of slots, so the pager keeps its
 * width — the Next button does not slide sideways as you page through.
 */
export function pageItems(current: number, count: number): Array<PageItem> {
  if (count <= SLOTS) return range(1, count);
  // Near either end there is no run to skip on that side, so the pages there
  // are listed in full and only the far side collapses.
  if (current <= 4) return [...range(1, 5), 'ellipsis', count];
  if (current >= count - 3) return [1, 'ellipsis', ...range(count - 4, count)];
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', count];
}
