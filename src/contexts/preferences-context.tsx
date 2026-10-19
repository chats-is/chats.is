import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react';

import { type Model } from '@/types';
import { modelMatchesId } from '@/lib/utils';

import { useSystemSettings } from './system-settings-context';

export interface Preferences {
  // Chat
  chatModelId: string;
  chatEffort: string;
  // Image
  imageModelId: string;
  imageEditModelId: string;
  imageSize: string;
  imageAspectRatio: string;
  imageResolution: string;
  // Video
  videoModelId: string;
  videoImageModelId: string;
  videoEditModelId: string;
  videoSize: string;
  videoAspectRatio: string;
  videoResolution: string;
  videoDuration?: number | 'auto';
  // Audio (TTS)
  audioModelId: string;
  audioVoice: string;
  // Transcription (STT)
  sttModelId: string;
  /** Whether the chat is offered the media tools: images, video, speech and
   *  transcription alike. */
  mediaGeneration: boolean;
  /** Whether the chat may search the web. */
  webSearch: boolean;
}

interface PreferencesContextValue {
  preferences: Preferences;
  setPreference: <TKey extends keyof Preferences>(
    key: TKey,
    value: Preferences[TKey]
  ) => void;
}

const STORAGE_KEY = 'user-preferences';

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function getStoredPreferences(): Partial<Preferences> | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

interface PreferencesProviderProps {
  children: ReactNode;
}

/** A reader who has chosen nothing: no model picked, every option unset. */
const UNCHOSEN: Preferences = {
  // Chat
  chatModelId: '',
  chatEffort: '',
  // Generation options are left empty until the user picks one. A hardcoded
  // seed is indistinguishable from a choice the user made, and both
  // `ModelMenu` and the server's `pickOption` prefer a selection over the
  // model's own `uiOptions` default — so a seeded value that happened to
  // appear in a model's allowed list silently overrode the default the admin
  // configured for that model.
  // Image
  imageModelId: '',
  imageEditModelId: '',
  imageSize: '',
  imageAspectRatio: '',
  imageResolution: '',
  // Video
  videoModelId: '',
  videoImageModelId: '',
  videoEditModelId: '',
  videoSize: '',
  videoAspectRatio: '',
  videoResolution: '',
  videoDuration: undefined,
  // Audio (TTS)
  audioModelId: '',
  audioVoice: '',
  // Transcription (STT)
  sttModelId: '',
  mediaGeneration: true,
  webSearch: true
};

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const {
    defaults,
    chatModels,
    imageModels,
    videoModels,
    ttsModels,
    sttModels
  } = useSystemSettings();

  // What the reader chose, as stored. Empty stored values are dropped: the
  // whole object is persisted on any write, so a modality the user never
  // picked is saved as '' and would otherwise shadow the fallback below.
  const [chosen, setChosen] = useState<Preferences>(() => {
    const stored = getStoredPreferences();
    if (!stored) return UNCHOSEN;
    const sanitized = Object.fromEntries(
      Object.entries(stored).filter(
        ([, value]) => value !== '' && value !== null && value !== undefined
      )
    );
    return { ...UNCHOSEN, ...sanitized };
  });

  // The model each choice comes to, settled against the models on offer now
  // rather than once — the lists change under an open page when a plan
  // changes. The reader's choice, else the admin's default, else the first
  // model on offer of its kind, in the order the console sets; only with none
  // on offer is nothing chosen, and the control shows its placeholder. An id
  // is on offer alias-aware, the way the server resolves one; a model
  // deleted, disabled or kept from the reader by their tier is not.
  const preferences = useMemo<Preferences>(() => {
    const resolves = (id: unknown, models: Model[] | undefined) =>
      typeof id === 'string' &&
      !!id &&
      !!models?.some(model => modelMatchesId(model, id));

    const settle = (
      id: string,
      systemId: string | null | undefined,
      models: Model[] | undefined
    ) =>
      resolves(id, models)
        ? id
        : resolves(systemId, models)
          ? (systemId as string)
          : (models?.[0]?.modelId ?? '');

    // Their own choices: only some image models can edit one, and only some
    // video models take an image as the first frame or edit a video.
    const editModels = imageModels?.filter(model => model.supportsImageEdit);
    const animateModels = videoModels?.filter(
      model => model.supportsImageToVideo
    );
    const videoEditModels = videoModels?.filter(
      model => model.supportsVideoEdit
    );

    return {
      ...chosen,
      chatModelId: settle(chosen.chatModelId, defaults.chatModelId, chatModels),
      imageModelId: settle(
        chosen.imageModelId,
        defaults.imageModelId,
        imageModels
      ),
      imageEditModelId: settle(
        chosen.imageEditModelId,
        defaults.imageEditModelId,
        editModels
      ),
      videoModelId: settle(
        chosen.videoModelId,
        defaults.videoModelId,
        videoModels
      ),
      videoImageModelId: settle(
        chosen.videoImageModelId,
        defaults.videoImageModelId,
        animateModels
      ),
      videoEditModelId: settle(
        chosen.videoEditModelId,
        defaults.videoEditModelId,
        videoEditModels
      ),
      audioModelId: settle(chosen.audioModelId, defaults.ttsModelId, ttsModels),
      sttModelId: settle(chosen.sttModelId, defaults.sttModelId, sttModels)
    };
  }, [
    chosen,
    defaults,
    chatModels,
    imageModels,
    videoModels,
    ttsModels,
    sttModels
  ]);

  const setPreference = useCallback(
    <TKey extends keyof Preferences>(key: TKey, value: Preferences[TKey]) => {
      setChosen(prev => {
        const newPrefs = { ...prev, [key]: value };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
        } catch {
          // ignore
        }
        return newPrefs;
      });
    },
    []
  );

  return (
    <PreferencesContext.Provider value={{ preferences, setPreference }}>
      {children}
    </PreferencesContext.Provider>
  );
}

/**
 * The reader's preferences, or null where there are none to read — a shared
 * chat, which anyone can open and which has no reader of its own. For the few
 * things drawn on both kinds of page that only want a preference as a hint.
 */
export function usePreferencesIfAny() {
  return useContext(PreferencesContext);
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}
