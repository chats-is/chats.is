/**
 * An error whose message was written for the person who will read it.
 *
 * A server function's error travels to the browser intact — that is how a
 * refused mutation reaches its toast. But the same road carries the ones
 * nobody wrote: a database that is down, a column that was renamed, a driver
 * quoting a connection string. Those say nothing to a reader and a little to
 * anyone else, so the boundary in `src/start.ts` replaces them and keeps the
 * original for the log.
 *
 * It can only tell the two apart if the deliberate ones say so. That is all
 * this class is: the difference, made checkable.
 *
 *     if (!quota) throw new PublicError('Quota not found');
 */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicError';
  }
}
