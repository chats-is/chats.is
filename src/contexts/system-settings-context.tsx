import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { type SystemSettings } from '@/types';
import { settingsQueries } from '@/server/functions/settings';

const SystemSettingsContext = createContext<SystemSettings | null>(null);

interface SystemSettingsProviderProps {
  settings: SystemSettings;
  children: ReactNode;
}

/**
 * `settings` is what the route's loader resolved, and covers the first render.
 * It is not what the tree goes on using: a value handed down from a loader is
 * read once and then stands for as long as the layout does, which for this one
 * is the life of the tab. Read through the cache instead — under the same key
 * the loader filled — it follows that query's own schedule for staying current
 * (see `settingsQueries.system`).
 */
export function SystemSettingsProvider({
  settings,
  children
}: SystemSettingsProviderProps) {
  const { data = settings } = useQuery(settingsQueries.system());

  return (
    <SystemSettingsContext.Provider value={data}>
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
