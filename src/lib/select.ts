/**
 * Base UI lets a select be cleared, so the value it reports back is nullable.
 * None of this app's selects offer clearing — every one of them is a choice
 * among options — so a change always carries a value.
 *
 * Stated here once rather than at each of the call sites, and it still can't
 * lie: if a clearable select is ever added, its handler won't fit through.
 */
export function onSelect<T extends string>(handler: (value: T) => void) {
  return (value: string | null) => {
    if (value !== null) handler(value as T);
  };
}
