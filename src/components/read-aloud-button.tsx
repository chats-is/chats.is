import * as React from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { Loader2, PauseCircle, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

import { createSpeech } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * Reads a message aloud.
 *
 * Its own component because it is the one thing in a message's action row
 * that needs the install's settings and the reader's preferences — which
 * models can speak, whether speech is switched on, which voice was picked.
 * Inside the row, those two reads made every page that shows a message depend
 * on both providers, the shared-chat page included, which shows no such button
 * and loaded the whole model catalogue to find that out.
 *
 * Draws nothing when speech is off or no model can speak.
 */
export function ReadAloudButton({ text }: { text: string }) {
  const { ttsModels, speechEnabled } = useSystemSettings();
  const isSpeechAvailable = (ttsModels?.length ?? 0) > 0 && speechEnabled;
  const { preferences } = usePreferences();
  // The same text-to-speech selection the chat tool uses: reading a message
  // aloud and generating speech in a reply are one setting, not two.
  const speechModel = preferences.audioModelId;
  const speechVoice = preferences.audioVoice;

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const onRead = async () => {
    // A voice is optional: unset means the user never picked one, and the
    // model's own default speaks. Requiring one here made the button do
    // nothing at all, silently, for anyone who had not been into the settings.
    if (isSpeechAvailable && speechModel) {
      setIsLoadingAudio(true);
      const result = await createSpeech(
        speechModel,
        speechVoice || undefined,
        text
      );
      setIsLoadingAudio(false);

      if (result && 'error' in result) {
        toast.error(result.error);
        setIsPlaying(false);
        return;
      }

      if (result.audio) {
        const audio = new Audio(result.audio);
        audioRef.current = audio;
        audio.volume = 1;
        audio.play();
        setIsPlaying(true);

        audio.onended = () => {
          setIsPlaying(false);
        };
      }
    }
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
    } else {
      if (audioRef.current) {
        audioRef.current.play();
      } else {
        onRead();
      }
      setIsPlaying(true);
    }
  };

  if (!isSpeechAvailable) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground"
      onClick={togglePlayPause}
      disabled={isLoadingAudio}
    >
      {isLoadingAudio ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isPlaying ? (
        <PauseCircle className="size-4" />
      ) : (
        <Volume2 className="size-4" />
      )}
      <span className="sr-only">
        {isLoadingAudio ? 'Loading...' : isPlaying ? 'Stop' : 'Play'}
      </span>
    </Button>
  );
}
