'use client';

import { api } from '@/trpc/react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import { SettingsLoading, SettingsSaveBar, useSettingsForm } from './shared';

const KEYS = ['default.quotaId'] as const;

export function QuotaSettings() {
  const { formData, handleChange, save, hasChanges, isLoading, isSaving } =
    useSettingsForm(KEYS);
  const { data: quotaOptions } = api.quota.listForSelect.useQuery();

  if (isLoading) return <SettingsLoading />;

  const isEmpty = !quotaOptions?.length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Default Quota</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Fallback quota for users without a plan.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Default Quota</Label>
            <Select
              disabled={isEmpty || isSaving}
              // Undefined when the saved id no longer names a quota, so the
              // placeholder shows instead of a blank trigger.
              value={
                quotaOptions?.some(
                  quota => quota.id === formData['default.quotaId']
                )
                  ? formData['default.quotaId']
                  : undefined
              }
              onValueChange={value => handleChange('default.quotaId', value)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isEmpty ? 'No quotas available' : 'Select a quota'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {quotaOptions?.map(quota => (
                  <SelectItem key={quota.id} value={quota.id}>
                    {quota.name}
                    {quota.isUnlimited ? ' (Unlimited)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <SettingsSaveBar
        hasChanges={hasChanges}
        isSaving={isSaving}
        onSave={save}
      />
    </div>
  );
}
