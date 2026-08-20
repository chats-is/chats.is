import { Metadata } from 'next';

import { QuotaSettings } from '@/components/console/settings/quota';

export const metadata: Metadata = {
  title: 'Quota Settings'
};

export default function Page() {
  return <QuotaSettings />;
}
