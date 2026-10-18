import { useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import {
  bulkUpdateSettings,
  settingsQueries
} from '@/server/functions/settings';
import { Button } from '@/components/ui/button';
import { useAppForm } from '@/components/app-form';

import { expand, readPath } from './settings-values';

/**
 * What the console's settings pages share: a form over some of the
 * settings table's keys, and the Save that writes just those. Settings and
 * Pages are each one of these.
 */

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

/** One object for every form that has no defaults, so it is the same one on
 *  every render. */
const NO_DEFAULTS: Record<string, string> = {};

/**
 * Load the settings, track edits, and save just these keys.
 *
 * `bulkUpdate` upserts only the keys it is given, so a save never touches a
 * row this page does not show.
 *
 * A setting key is a dotted path (`app.name`, `default.chat.modelId`), which
 * is exactly how the form addresses a nested field — so the keys are expanded
 * into an object here and a block names its fields with the key itself.
 *
 * `defaults` is what a field shows for a key with no value, and `toValue`
 * turns what a field holds into what is saved; left out, an empty field
 * saves as no value.
 */
export function useSettingsForm(
  keys: readonly string[],
  {
    defaults = NO_DEFAULTS,
    toValue = (_key, value) => value || null
  }: {
    defaults?: Record<string, string>;
    toValue?: (key: string, value: string) => string | null;
  } = {}
) {
  const queryClient = useQueryClient();
  const { data: settings, isFetching } = useQuery(settingsQueries.list());

  const mutation = useMutation({
    mutationFn: mutating(bulkUpdateSettings),
    onSuccess: () => {
      // Every reader of the settings table, not only the list this form
      // edits: the app's name and the system settings are the same rows read
      // from elsewhere, out of the same cache, and a save that cleared only
      // this page would leave them showing what was there before.
      queryClient.invalidateQueries({ queryKey: settingsQueries.all() });
      toast.success('Settings saved successfully');
    },
    onError: error => toast.error(error.message)
  });

  const form = useAppForm({
    // Built on the first render rather than reset into place afterwards: the
    // route prefetches this query, so the values are already in the cache when
    // the form is created — including on the server, where an effect would
    // never run and the page would have rendered a placeholder instead.
    defaultValues: valuesOf(settings, defaults),
    onSubmit: async ({ value }) => {
      const saved = keys.map(key => ({
        key,
        value: toValue(key, readPath(value, key))
      }));
      await mutation.mutateAsync(saved);
      // The cache first, then the form. The form is handed the cached rows
      // as its defaults on every render, and takes new defaults over values
      // nobody has touched — so reset against the rows as they were, it
      // would show them again until the refetch came back: a switch just
      // turned on would flick off, then on.
      queryClient.setQueryData(settingsQueries.list().queryKey, rows =>
        rows ? withSaved(rows, saved) : rows
      );
      // The values just saved become the ones "no changes" is measured from,
      // so the Save button settles rather than staying lit.
      form.reset(value);
    }
  });

  // Read inside the effect without making it a dependency — depending on it
  // would re-run the sync on the very edit it is meant to protect.
  const isDirty = useStore(form.store, state => state.isDirty);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Only for what arrives after that first render. `settings.list` refetches
  // in the background once it is stale and the view is mounted again, which
  // would otherwise leave the form showing values the server no longer has.
  const settled = useRef(settings);

  useEffect(() => {
    if (!settings || settled.current === settings) return;
    settled.current = settings;

    // Leave edits alone: overwriting them would be silent, since the same pass
    // clears the dirty flag and disables Save. The next successful save
    // re-reads from the server anyway.
    if (isDirtyRef.current) return;

    form.reset(valuesOf(settings, defaults));
  }, [settings, form, defaults]);

  // Held while the values are on their way — drawn from what was held, if
  // anything was, but not to be edited until they are what the server has.
  // Not once something has been edited: that read is going to be ignored.
  const isHeld = isFetching && !isDirty;

  return { form, isHeld };
}

/** The cached rows with a save applied: each key's value replaced, and a key
 *  that had no row given one, as the server has just done. */
function withSaved<TRow extends { key: string; value: string | null }>(
  rows: TRow[],
  saved: Array<{ key: string; value: string | null }>
): TRow[] {
  const values = new Map(saved.map(s => [s.key, s.value]));
  const next = rows.map(row =>
    values.has(row.key) ? { ...row, value: values.get(row.key) ?? null } : row
  );
  for (const { key, value } of saved) {
    if (!rows.some(row => row.key === key)) {
      next.push({ ...rows[0], id: key, key, value });
    }
  }
  return next;
}

/** The rows as the form holds them: dotted keys expanded into an object,
 *  with a key that has no value showing its default. */
function valuesOf(
  settings: Array<{ key: string; value: string | null }> | undefined,
  defaults: Record<string, string>
) {
  const flat: Record<string, string> = {};
  (settings ?? []).forEach(setting => {
    flat[setting.key] = setting.value || '';
  });
  for (const [key, value] of Object.entries(defaults)) flat[key] ||= value;
  return expand(flat);
}

/**
 * The form this page holds. Its values are a tree of strings whose shape
 * depends on which keys the page owns, so the typing stops here.
 */
export type SettingsFormApi = ReturnType<typeof useSettingsForm>['form'];

/**
 * The page's fields, and the Save that commits them. Submitting is what
 * saves, so the button is inside the form rather than wired to a handler.
 * Held — every field and the button — while the values are being read.
 */
export function SettingsForm({
  form,
  isHeld,
  children
}: {
  form: SettingsFormApi;
  isHeld: boolean;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <fieldset disabled={isHeld} className="min-w-0 space-y-6">
        {children}
        <SettingsSaveBar form={form} />
      </fieldset>
    </form>
  );
}

/**
 * Save, lit only once something has actually been edited. The form is the one
 * that knows, so the bar reads it rather than being told.
 */
function SettingsSaveBar({ form }: { form: SettingsFormApi }) {
  const isDirty = useStore(form.store, state => state.isDirty);
  const isSubmitting = useStore(form.store, state => state.isSubmitting);

  return (
    <div className="flex items-center justify-start">
      <Button
        type="submit"
        disabled={!isDirty || isSubmitting}
        className="gap-2"
      >
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {isSubmitting ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );
}
