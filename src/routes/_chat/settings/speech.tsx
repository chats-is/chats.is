import { createFileRoute } from '@tanstack/react-router';

import { getSystemSettingsFn } from '@/server/fn/settings';
import { SettingsSpeech } from '@/components/settings-speech';

export const Route = createFileRoute('/_chat/settings/speech')({
  loader: async () => {
    const { ttsModels, speechEnabled } = await getSystemSettingsFn();
    return { isSpeechAvailable: (ttsModels?.length ?? 0) > 0 && speechEnabled };
  },
  head: () => ({ meta: [{ title: 'Speech Settings' }] }),
  component: SpeechSettings
});

function SpeechSettings() {
  const { isSpeechAvailable } = Route.useLoaderData();

  if (!isSpeechAvailable) {
    return null;
  }

  return (
    <section className="w-full">
      <SettingsSpeech />
    </section>
  );
}
