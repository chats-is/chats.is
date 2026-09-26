import { type WebSearchMode } from '@/lib/web-search';

import { type Model } from './model';

export interface SystemDefaults {
  chatModelId: string | null;
  imageModelId: string | null;
  imageEditModelId: string | null;
  videoModelId: string | null;
  videoImageModelId: string | null;
  videoEditModelId: string | null;
  ttsModelId: string | null;
  sttModelId: string | null;
}

export interface SystemSettings {
  speechEnabled: boolean;
  chatModels: Model[];
  imageModels: Model[];
  videoModels: Model[];
  ttsModels: Model[];
  sttModels: Model[];
  defaults: SystemDefaults;
  /** How a chat searches, and the search model when one is set and can
   *  answer — enough for the page to know whether to offer the switch. */
  webSearch: { mode: WebSearchMode; searchModelId: string | null };
}
