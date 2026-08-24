'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState
} from 'react';

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
  videoDuration: number;
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
  const { defaults } = useSystemSettings();

  const [preferences, setPreferences] = useState<Preferences>(() => {
    const defaultPrefs: Preferences = {
      // Chat
      chatModelId: defaults.chatModelId ?? '',
      chatReasoning: true,
      // Image
      imageModelId: defaults.imageModelId ?? '',
      imageSize: '1024x1024',
      imageAspectRatio: '16:9',
      // Video
      videoModelId: defaults.videoModelId ?? '',
      videoAspectRatio: '16:9',
      videoResolution: '720p',
      videoDuration: 6,
      // Audio (TTS)
      audioModelId: defaults.ttsModelId ?? '',
      // Empty until the user picks one. A hardcoded seed here reads as a
      // choice the user never made: `ModelMenu` prefers the stored preference
      // over the model's own `uiOptions.voice`, so seeding a real voice name
      // shadowed whatever default the admin configured for the model.
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
