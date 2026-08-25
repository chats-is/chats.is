'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState
} from 'react';

import { Model } from '@/types';
import { modelMatchesId } from '@/lib/utils';

import { useSystemSettings } from './system-settings-context';

export interface Preferences {
  // Chat
  chatModelId: string;
  chatReasoning: boolean;
  // Image
  imageModelId: string;
  imageEditModelId: string;
  imageSize: string;
  imageAspectRatio: string;
  // Video
  videoModelId: string;
  videoImageModelId: string;
  videoEditModelId: string;
  videoAspectRatio: string;
  videoResolution: string;
  videoDuration?: number;
  // Audio (TTS)
  audioModelId: string;
  audioVoice: string;
  // Transcription (STT)
  sttModelId: string;
}

interface PreferencesContextValue {
  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K]
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

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const {
    defaults,
    chatModels,
    imageModels,
    videoModels,
    ttsModels,
    sttModels
  } = useSystemSettings();

  const [preferences, setPreferences] = useState<Preferences>(() => {
    // A model id is only usable if it is still among the models the server
    // offers — alias-aware, the way the server resolves one. Deleting or
    // disabling a model leaves its id behind in two places: the admin's system
    // default, and every browser that stored it as a preference. Neither is a
    // value a selector can display, so both are treated as unset and the
    // control shows its placeholder rather than an empty pill.
    const resolves = (id: unknown, models: Model[] | undefined) =>
      typeof id === 'string' &&
      !!id &&
      !!models?.some(model => modelMatchesId(model, id));

    const systemDefault = (
      id: string | null | undefined,
      models: Model[] | undefined
    ) => (resolves(id, models) ? (id as string) : '');

    const editModels = imageModels?.filter(model => model.supportsEdit);
    const animateModels = videoModels?.filter(model => model.supportsEdit);
    const videoEditModels = videoModels?.filter(
      model => model.supportsVideoEdit
    );

    const defaultPrefs: Preferences = {
      // Chat
      chatModelId: systemDefault(defaults.chatModelId, chatModels),
      chatReasoning: true,
      // Generation options are left empty until the user picks one. A
      // hardcoded seed is indistinguishable from a choice the user made, and
      // both `ModelMenu` and the server's `pickOption` prefer a selection over
      // the model's own `uiOptions` default — so a seeded value that happened
      // to appear in a model's allowed list silently overrode the default the
      // admin configured for that model.
      // Image
      imageModelId: systemDefault(defaults.imageModelId, imageModels),
      // Its own choice: only some image models can edit one.
      imageEditModelId: systemDefault(defaults.imageEditModelId, editModels),
      imageSize: '',
      imageAspectRatio: '',
      // Video
      videoModelId: systemDefault(defaults.videoModelId, videoModels),
      // Its own choice: only some video models take an image as the first frame.
      videoImageModelId: systemDefault(
        defaults.videoImageModelId,
        animateModels
      ),
      videoEditModelId: systemDefault(
        defaults.videoEditModelId,
        videoEditModels
      ),
      videoAspectRatio: '',
      videoResolution: '',
      videoDuration: undefined,
      // Audio (TTS)
      audioModelId: systemDefault(defaults.ttsModelId, ttsModels),
      audioVoice: '',
      // Transcription (STT)
      sttModelId: systemDefault(defaults.sttModelId, sttModels)
    };

    const stored = getStoredPreferences();
    if (stored) {
      // Drop empty stored values: the whole prefs object is persisted on any
      // write, so a modality the user never picked is saved as '' and would
      // otherwise shadow a system default the admin configures later.
      const sanitized = Object.fromEntries(
        Object.entries(stored).filter(
          ([, value]) => value !== '' && value !== null && value !== undefined
        )
      );

      // Same for stored ids: dropping one falls back to the system default,
      // exactly as it does for a user who never chose.
      const modelKeys: Array<[keyof Preferences, Model[] | undefined]> = [
        ['chatModelId', chatModels],
        ['imageModelId', imageModels],
        ['imageEditModelId', editModels],
        ['videoModelId', videoModels],
        ['videoImageModelId', animateModels],
        ['videoEditModelId', videoEditModels],
        ['audioModelId', ttsModels],
        ['sttModelId', sttModels]
      ];
      for (const [key, models] of modelKeys) {
        if (key in sanitized && !resolves(sanitized[key], models)) {
          delete sanitized[key];
        }
      }

      return { ...defaultPrefs, ...sanitized };
    }

    return defaultPrefs;
  });

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences(prev => {
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

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}
