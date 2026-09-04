import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { bulkUpdateSettings, settingsQueries } from '@/server/fn/settings';
import { Button } from '@/components/ui/button';
import { ConsoleSettingsPanelSkeleton } from '@/components/console/skeletons';

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
 */
export function useSettingsForm(keys: readonly string[]) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery(settingsQueries.list());
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  // Read inside the hydrate effect without making it a dependency — depending
  // on it would re-run hydration on the very edit it is meant to protect.
  const hasChangesRef = useRef(false);
  hasChangesRef.current = hasChanges;

  useEffect(() => {
    if (!settings) return;
    // `settings.list` refetches in the background (30s staleTime, and React
    // Query refetches on window focus by default), which would otherwise
    // overwrite whatever the user has typed — silently, since the same pass
    // would clear hasChanges and disable Save. Leave edits alone; the next
    // successful save re-hydrates from the server anyway.
    if (hasChangesRef.current) return;

    const data: Record<string, string> = {};
    settings.forEach(setting => {
      data[setting.key] = setting.value || '';
    });
    if (!data['speech.enabled']) {
      data['speech.enabled'] = 'false';
    }
    setFormData(data);
    setHasChanges(false);
  }, [settings]);

  const mutation = useMutation({
    mutationFn: mutating(bulkUpdateSettings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsQueries.key.list() });
      setHasChanges(false);
      toast.success('Settings saved successfully');
    },
    onError: error => toast.error(error.message)
  });

  const handleChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const save = () => {
    mutation.mutate(
      keys.map(key => ({
        key,
        value: formData[key] || null,
        description: SETTING_DESCRIPTIONS[key]
      }))
    );
  };

  return {
    formData,
    handleChange,
    save,
    hasChanges,
    isLoading,
    isSaving: mutation.isPending
  };
}

export function SettingsLoading() {
  return <ConsoleSettingsPanelSkeleton />;
}

export function SettingsSaveBar({
  hasChanges,
  isSaving,
  onSave
}: {
  hasChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center justify-start">
      <Button
        onClick={onSave}
        disabled={!hasChanges || isSaving}
        className="gap-2"
      >
        {isSaving && <Loader2 className="size-4 animate-spin" />}
        {isSaving ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );
}
