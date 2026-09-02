import { createContext, ReactNode, useContext } from 'react';

import { SystemSettings } from '@/types';

const SystemSettingsContext = createContext<SystemSettings | null>(null);

interface SystemSettingsProviderProps {
  settings: SystemSettings;
  children: ReactNode;
}

export function SystemSettingsProvider({
  settings,
  children
}: SystemSettingsProviderProps) {
  return (
    <SystemSettingsContext.Provider value={settings}>
      {children}
    </SystemSettingsContext.Provider>
  );
}

export function useSystemSettings() {
  const context = useContext(SystemSettingsContext);
  if (!context) {
    throw new Error(
      'useSystemSettings must be used within SystemSettingsProvider'
    );
  }
  return context;
}
