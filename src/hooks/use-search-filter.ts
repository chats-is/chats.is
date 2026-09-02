import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

/** Every filter the console puts in the address. */
type Filters = {
  q: string;
  capability: string;
  model: string;
  user: string;
  days: number;
  page: number;
};

/**
 * Filters typed into a box change on every keystroke, so they replace the
 * current entry — a search for "grok" must not leave five entries behind it.
 * A filter chosen deliberately gets its own entry, so the back button undoes
 * the choice rather than leaving the page.
 */
const TYPED: ReadonlySet<keyof Filters> = new Set(['q', 'user']);

type Update<TValue> = TValue | ((previous: TValue) => TValue);

/**
 * A filter that lives in the address rather than in the component.
 *
 * Reads like `useState` at the call site, so the components that had these as
 * local state keep their shape — but the value is now part of the URL, which
 * is what makes a filtered view something you can link to, refresh, or come
 * back to.
 *
 * A filter left at its default is dropped from the address, so an unfiltered
 * page has a clean URL and no two links mean the same view.
 */
export function useSearchFilter<TKey extends keyof Filters>(
  key: TKey,
  fallback: Filters[TKey]
): [Filters[TKey], (value: Update<Filters[TKey]>) => void] {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Partial<Filters>;

  const set = useCallback(
    (next: Update<Filters[TKey]>) => {
      void navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => {
          const current = (previous[key] ?? fallback) as Filters[TKey];
          const value =
            typeof next === 'function'
              ? (next as (p: Filters[TKey]) => Filters[TKey])(current)
              : next;

          const rest = { ...previous };
          delete rest[key];
          return value === fallback ? rest : { ...rest, [key]: value };
        },
        replace: TYPED.has(key)
      });
    },
    [navigate, key, fallback]
  );

  return [(search[key] ?? fallback) as Filters[TKey], set];
}
