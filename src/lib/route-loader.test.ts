import { QueryClient, queryOptions } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { loadForVisit } from './route-loader';

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
