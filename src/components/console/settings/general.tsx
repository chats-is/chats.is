import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { SettingsLoading, SettingsSaveBar, useSettingsForm } from './shared'

const KEYS = ['app.name', 'app.subtitle', 'app.description'] as const

export function GeneralSettings() {
  const { formData, handleChange, save, hasChanges, isLoading, isSaving } =
    useSettingsForm(KEYS)

  if (isLoading) return <SettingsLoading />

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Application</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="app.name">App Name</Label>
            <Input
              id="app.name"
              value={formData['app.name'] || ''}
              onChange={(e) => handleChange('app.name', e.target.value)}
              placeholder="Chats.is"
              disabled={isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="app.subtitle">App Subtitle</Label>
            <Input
              id="app.subtitle"
              value={formData['app.subtitle'] || ''}
              onChange={(e) => handleChange('app.subtitle', e.target.value)}
              placeholder="AI Chatbot"
              disabled={isSaving}
            />
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="app.description">App Description</Label>
            <Textarea
              id="app.description"
              value={formData['app.description'] || ''}
              onChange={(e) => handleChange('app.description', e.target.value)}
              placeholder="Your AI assistant..."
              rows={3}
              disabled={isSaving}
            />
          </div>
        </div>
      </div>

      <SettingsSaveBar
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSave={save}
      />
    </div>
  )
}
