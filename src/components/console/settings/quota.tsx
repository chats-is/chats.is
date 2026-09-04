import { useQuery } from '@tanstack/react-query';

import { quotaQueries } from '@/server/fn/quota';

import { SettingsForm, SettingsLoading, useSettingsForm } from './shared';

const KEYS = ['default.quotaId'] as const;

export function QuotaSettings() {
  const { form, isLoading } = useSettingsForm(KEYS);
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());

  if (isLoading) return <SettingsLoading />;

  const isEmpty = !quotaOptions?.length;
  const options = (quotaOptions ?? []).map(quota => ({
    value: quota.id,
    label: quota.name + (quota.isUnlimited ? ' (Unlimited)' : '')
  }));

  return (
    <SettingsForm form={form}>
      <div className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Default Quota</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Fallback quota for users without a plan.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <form.AppField name="default.quotaId">
            {field => (
              <field.SelectField
                label="Default Quota"
                options={options}
                disabled={isEmpty}
                placeholder={isEmpty ? 'No quotas available' : 'Select a quota'}
              />
            )}
          </form.AppField>
        </div>
      </div>
    </SettingsForm>
  );
}
