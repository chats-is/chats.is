import { useEffect, useRef, useState } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { bulkUpdateSettings, settingsQueries } from '@/server/fn/settings';
import { Button } from '@/components/ui/button';
import { useAppForm } from '@/components/app-form';
import { ConsoleSettingsPanelSkeleton } from '@/components/console/skeletons';

import { expand, readPath } from './values';

/**
 * Descriptions persisted alongside each setting. Kept in one place because the
 * settings are split across pages but the descriptions are a property of the
 * key, not of the page that happens to edit it.
 */
const SETTING_DESCRIPTIONS: Record<string, string> = {
  'app.name': 'Product name displayed in the UI',
  'app.subtitle': 'Product subtitle',
  'app.description': 'Product description for SEO',
  'default.chat.modelId': 'Default model for chat',
  'default.image.modelId': 'Default model for image generation',
  'default.image.editModelId': 'Default model for editing an existing image',
  'default.video.modelId': 'Default model for video generation',
  'default.video.imageModelId':
    'Default model for turning an image into a video',
  'default.video.editModelId': 'Default model for editing an existing video',
  'default.tts.modelId':
    'Default model for text-to-speech, including reading messages aloud',
  'default.stt.modelId':
    'Default model for speech-to-text (chat transcribe tool)',
  'speech.enabled': 'Enable or disable reading messages aloud',
  'default.chat.systemPrompt': 'Default system prompt for chat',
  'title.modelId': 'Model used for generating chat titles',
  'default.quotaId': 'Quota id used for users without an assigned plan'
};

/**
 * Load the settings a page owns, track edits, and save just those keys.
 *
 * Every settings page runs this hook with its own key list. They share one
 * `settings.list` query through the React Query cache, so navigating between
 * pages costs no extra request, and `bulkUpdate` upserts only the keys it is
 * given — so saving one section never clobbers another.
 *
 * A setting key is a dotted path (`app.name`, `default.chat.modelId`), which
 * is exactly how the form addresses a nested field — so the keys are expanded
 * into an object here and a page names its fields with the key itself.
 */
export function useSettingsForm(keys: readonly string[]) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery(settingsQueries.list());

  const mutation = useMutation({
    mutationFn: mutating(bulkUpdateSettings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.key.list() });
      toast.success('Settings saved successfully');
    },
    onError: error => toast.error(error.message)
  });

  const form = useAppForm({
    defaultValues: {},
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(
        keys.map(key => ({
          key,
          value: readPath(value, key) || null,
          description: SETTING_DESCRIPTIONS[key]
        }))
      );
      // The values just saved become the ones "no changes" is measured from,
      // so the Save button settles rather than staying lit.
      form.reset(value);
    }
  });

  // Read inside the hydrate effect without making it a dependency — depending
  // on it would re-run hydration on the very edit it is meant to protect.
  const isDirty = useStore(form.store, state => state.isDirty);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // The values arrive in an effect, which runs after the first render with
  // data. Until then the fields would mount against an empty form — React
  // would call them uncontrolled and the page would flash blank — so the page
  // keeps waiting until the form actually holds something.
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (!settings) return;
    // `settings.list` refetches in the background (30s staleTime, and React
    // Query refetches on window focus by default), which would otherwise
    // overwrite whatever the user has typed — silently, since the same pass
    // would clear the dirty flag and disable Save. Leave edits alone; the next
    // successful save re-hydrates from the server anyway.
    if (isDirtyRef.current) return;

    const flat: Record<string, string> = {};
    settings.forEach(setting => {
      flat[setting.key] = setting.value || '';
    });
    if (!flat['speech.enabled']) {
      flat['speech.enabled'] = 'false';
    }
    form.reset(expand(flat));
    setIsHydrated(true);
  }, [settings, form]);

  return { form, isLoading: isLoading || !isHydrated };
}

export function SettingsLoading() {
  return <ConsoleSettingsPanelSkeleton />;
}

/**
 * Save, lit only once something has actually been edited. The form is the one
 * that knows, so the bar reads it rather than being told.
 */
export function SettingsSaveBar({ form }: { form: SettingsFormApi }) {
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

/**
 * The form a settings page holds. Its values are a tree of strings whose shape
 * depends on which keys the page owns, so the page-specific typing stops here.
 */
export type SettingsFormApi = ReturnType<typeof useSettingsForm>['form'];

/**
 * A settings page: its fields, and the Save that commits them. Submitting is
 * what saves, so the button is inside the form rather than wired to a handler.
 */
export function SettingsForm({
  form,
  children
}: {
  form: SettingsFormApi;
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-6"
    >
      {children}
      <SettingsSaveBar form={form} />
    </form>
  );
}
