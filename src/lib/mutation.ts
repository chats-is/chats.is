/**
 * A server function is called with `{ data }`; a mutation is called with the
 * data itself. This is the one line between them, so every call site can keep
 * saying `mutate({ id })` and mean it.
 */
export function mutating<TData, TResult>(
  fn: (opts: { data: TData }) => Promise<TResult>
): (data: TData) => Promise<TResult> {
  return data => fn({ data });
}
