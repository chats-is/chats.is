import { describe, expect, it } from 'vitest';

import { pageCount, pageItems } from './pagination';

describe('pageCount', () => {
  it('counts the partial last page', () => {
    expect(pageCount(41, 20)).toBe(3);
    expect(pageCount(40, 20)).toBe(2);
  });

  it('reports one page when there is nothing to page through', () => {
    expect(pageCount(0, 20)).toBe(1);
  });
});

describe('pageItems', () => {
  it('lists every page while they all fit', () => {
    expect(pageItems(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('collapses the far side only, near either end', () => {
    expect(pageItems(2, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20]);
    expect(pageItems(19, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20]);
  });

  it('keeps a neighbour each side of a page in the middle', () => {
    expect(pageItems(10, 20)).toEqual([
      1,
      'ellipsis',
      9,
      10,
      11,
      'ellipsis',
      20
    ]);
  });

  it('keeps its width wherever the current page sits', () => {
    const widths = new Set(
      Array.from({ length: 20 }, (_, i) => pageItems(i + 1, 20).length)
    );
    expect([...widths]).toEqual([7]);
  });
});
