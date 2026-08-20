import { Metadata } from 'next';

import { GeneralSettings } from '@/components/console/settings/general';

export const metadata: Metadata = {
  title: 'General Settings'
};

export default function Page() {
  return <GeneralSettings />;
}
