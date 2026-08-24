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
  imageSize: string;
  imageAspectRatio: string;
  // Video
  videoModelId: string;
  videoAspectRatio: string;
  videoResolution: string;
  videoDuration?: number;
  // Audio (TTS)
  audioModelId: string;
  audioVoice: string;
  // Transcription (STT)
  sttModelId: string;
  // Speech (read aloud)
  speechModelId: string;
  speechVoice: string;
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
    const defaultPrefs: Preferences = {
      // Chat
      chatModelId: defaults.chatModelId ?? '',
      chatReasoning: true,
      // Generation options are left empty until the user picks one. A
      // hardcoded seed is indistinguishable from a choice the user made, and
      // both `ModelMenu` and the server's `pickOption` prefer a selection over
      // the model's own `uiOptions` default — so a seeded value that happened
      // to appear in a model's allowed list silently overrode the default the
      // admin configured for that model.
      // Image
      imageModelId: defaults.imageModelId ?? '',
      imageSize: '',
      imageAspectRatio: '',
      // Video
      videoModelId: defaults.videoModelId ?? '',
      videoAspectRatio: '',
      videoResolution: '',
      videoDuration: undefined,
      // Audio (TTS)
      audioModelId: defaults.ttsModelId ?? '',
      audioVoice: '',
      // Transcription (STT)
      sttModelId: defaults.sttModelId ?? '',
      // Speech (read aloud)
      speechModelId: defaults.speechModelId ?? 'tts-1',
      speechVoice: defaults.speechVoice ?? 'alloy'
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

      // Drop stored model ids that no longer resolve. A model the admin has
      // since deleted or disabled is still sitting in localStorage, and it is
      // not a value any selector can display — the control renders blank and
      // the request carries an id the server cannot look up. Falling back to
      // the system default is what an unset preference already does.
      const resolves = (id: unknown, models: Model[] | undefined) =>
        typeof id === 'string' &&
        !!models?.some(model => modelMatchesId(model, id));

      const modelKeys: Array<[keyof Preferences, Model[] | undefined]> = [
        ['chatModelId', chatModels],
        ['imageModelId', imageModels],
        ['videoModelId', videoModels],
        ['audioModelId', ttsModels],
        ['speechModelId', ttsModels],
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
