'use client';

import { useEffect, useMemo } from 'react';
import { usePreferences } from '@/contexts/preferences-context';
import { useSystemSettings } from '@/contexts/system-settings-context';

import { Label as UiLabel } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ModelIcon } from '@/components/model-icon';

export const SettingsSpeech = () => {
  const { ttsModels, defaults } = useSystemSettings();
  const { preferences, setPreference } = usePreferences();

  const speechModel = preferences.speechModelId;
  const speechVoice = preferences.speechVoice;

  const selectedModel = useMemo(
    () => ttsModels?.find(m => m.modelId === speechModel),
    [ttsModels, speechModel]
  );

  // Get available voices from current model's uiOptions
  const availableVoices = useMemo(() => {
    const voices = selectedModel?.uiOptions?.voices as string[] | undefined;
    return voices || [];
  }, [selectedModel]);

  // Reset the voice when the selected model cannot speak it, preferring the
  // admin's default and then the model's own before falling back to the first
  // — the same order the server's `pickVoice` uses.
  useEffect(() => {
    if (availableVoices.length === 0 || availableVoices.includes(speechVoice)) {
      return;
    }

    const modelVoice = selectedModel?.uiOptions?.voice;
    const next =
      defaults.speechVoice && availableVoices.includes(defaults.speechVoice)
        ? defaults.speechVoice
        : modelVoice && availableVoices.includes(modelVoice)
          ? modelVoice
          : availableVoices[0];

    setPreference('speechVoice', next);
  }, [
    availableVoices,
    speechVoice,
    selectedModel,
    defaults.speechVoice,
    setPreference
  ]);

  const handleModelChange = (value: string) => {
    setPreference('speechModelId', value);
  };

  const handleVoiceChange = (value: string) => {
    setPreference('speechVoice', value);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between space-y-0">
        <UiLabel>Model</UiLabel>
        <Select onValueChange={handleModelChange} value={speechModel}>
          <SelectTrigger className="w-auto rounded-full">
            {/* Children override the placeholder whenever a value is set, so
                an id that resolves to nothing would render an empty pill. */}
            <SelectValue placeholder="Select a model">
              {selectedModel && (
                <div className="flex items-center">
                  <ModelIcon
                    image={selectedModel.image || selectedModel.provider?.image}
                    className="mr-2 size-4"
                  />
                  <span>{selectedModel.name}</span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ttsModels?.map(model => (
              <SelectItem key={model.id} value={model.modelId}>
                <div className="flex items-center">
                  <ModelIcon
                    image={model.image || model.provider?.image}
                    className="mr-2 size-4"
                  />
                  <div>
                    <div>{model.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {model.modelId}
                    </div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between space-y-0">
        <UiLabel>Voice</UiLabel>
        <Select
          onValueChange={handleVoiceChange}
          value={speechVoice}
          disabled={availableVoices.length === 0}
        >
          <SelectTrigger className="w-auto rounded-full capitalize">
            <SelectValue placeholder="Select a voice">
              {speechVoice}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableVoices.map(voice => (
              <SelectItem className="capitalize" key={voice} value={voice}>
                {voice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
