/**
 * An error whose message was written for the person who will read it.
 *
 * A server function's error travels to the browser intact — that is how a
 * refused mutation reaches its toast. But the same road carries the ones
 * nobody wrote: a database that is down, a column that was renamed, a driver
 * quoting a connection string. Those say nothing to a user and a little to
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

/**
 * What a refused input said, if `error` is one.
 *
 * A server function's validator has no error type of its own: the framework
 * throws a plain `Error` whose message is the list of issues as JSON. That is
 * the only mark it carries, so it is read for exactly that shape and nothing
 * looser — a list of objects that each have a `message` and a `path`.
 *
 * The first issue is the one reported. They were written for a reader — the
 * same schemas label the forms — and the rest are usually its consequences.
 */
export function validationMessage(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message.startsWith('[')) return;

  try {
    const issues: unknown = JSON.parse(error.message);
    if (!Array.isArray(issues) || issues.length === 0) return;

    const isIssue = (issue: unknown): issue is { message: string } =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as { message?: unknown }).message === 'string' &&
      Array.isArray((issue as { path?: unknown }).path);

    return issues.every(isIssue) ? issues[0].message : undefined;
  } catch {
    return undefined;
  }
}
