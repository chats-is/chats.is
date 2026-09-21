import {
  infiniteQueryOptions,
  QueryClient,
  queryOptions
} from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { loadForVisit, openGallery } from './route-loader';

const table = (queryFn: () => Promise<string>) =>
  queryOptions({ queryKey: ['table', { page: 3 }], queryFn });

describe('loadForVisit', () => {
  it('waits for the data when the page is being arrived at', async () => {
    const client = new QueryClient();
    const rows = await loadForVisit(
      client,
      table(async () => 'rows'),
      'enter'
    );

    expect(rows).toBe('rows');
  });

  it('starts the read and returns at once when the page is being stayed on', async () => {
    const client = new QueryClient();
    let finish: (rows: string) => void = () => {};
    const queryFn = vi.fn(
      () => new Promise<string>(resolve => (finish = resolve))
    );
    const options = table(queryFn);

    // The loader's promise is what the router waits on, so it is what has to
    // be settled while the read is still out — not merely the call returning.
    await loadForVisit(client, options, 'stay');

    // Asked for, under the key the table reads — and nobody made to wait.
    expect(queryFn).toHaveBeenCalledOnce();
    expect(client.getQueryData(options.queryKey)).toBeUndefined();

    finish('rows');
    await vi.waitFor(() =>
      expect(client.getQueryData(options.queryKey)).toBe('rows')
    );
  });

  it('lets a failed read reach the route when arriving, not when staying', async () => {
    const failing = () => Promise.reject(new Error('down'));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    await expect(loadForVisit(client, table(failing), 'enter')).rejects.toThrow(
      'down'
    );
    await expect(
      loadForVisit(client, table(failing), 'stay')
    ).resolves.toBeUndefined();
  });
});

describe('openGallery', () => {
  const gallery = (queryFn: () => Promise<string[]>) =>
    infiniteQueryOptions({
      queryKey: ['gallery'],
      queryFn,
      initialPageParam: 0,
      getNextPageParam: (_last: string[], all: string[][]) => all.length
    });

  it('waits for the first page when nothing is held', async () => {
    const client = new QueryClient();
    const queryFn = vi.fn(async () => ['a', 'b']);

    await openGallery(client, gallery(queryFn));

    expect(queryFn).toHaveBeenCalledOnce();
    expect(client.getQueryData(['gallery'])).toMatchObject({
      pages: [['a', 'b']]
    });
  });

  /**
   * An infinite query refetches every page it holds. A library scrolled ten
   * pages deep would ask for all ten again to refresh the first — so it is cut
   * back on the way in. And cut back is not the same as refreshed: the entry
   * has to stay as old as it was, or the refetch behind the page — the one
   * that brings the new items in — never happens.
   */
  it('opens from the cache at once, cut back to a first page that is no newer', async () => {
    const client = new QueryClient();
    const queryFn = vi.fn(async () => ['fresh']);
    const heldSince = Date.now() - 60_000;
    client.setQueryData(
      ['gallery'],
      { pages: [['a'], ['b'], ['c']], pageParams: [0, 1, 2] },
      { updatedAt: heldSince }
    );

    await openGallery(client, gallery(queryFn));

    expect(queryFn).not.toHaveBeenCalled();
    expect(client.getQueryData(['gallery'])).toEqual({
      pages: [['a']],
      pageParams: [0]
    });
    expect(client.getQueryState(['gallery'])?.dataUpdatedAt).toBe(heldSince);
  });
});
