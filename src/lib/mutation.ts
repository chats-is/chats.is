/**
 * A server function is called with `{ data }`; a mutation is called with the
 * data itself. This is the one line between them, so every call site can keep
 * saying `mutate({ id })` and mean it.
 *
 * The data type is read back off the function rather than declared, since a
 * server function's options carry more than `data` and inference would
 * otherwise give up and fall through to `void`.
 */
/** What a server function is called with, as a mutation sees it. */
export type Input<TFn> = DataOf<TFn>;

type DataOf<TFn> = TFn extends (opts: infer TOpts) => unknown
  ? TOpts extends { data: infer TData }
    ? TData
    : never
  : never;

export function mutating<TFn extends (opts: never) => Promise<unknown>>(
  fn: TFn
): (data: DataOf<TFn>) => Promise<Awaited<ReturnType<TFn>>> {
  return data =>
    (fn as unknown as (opts: { data: unknown }) => Promise<
      Awaited<ReturnType<TFn>>
    >)({ data });
}
