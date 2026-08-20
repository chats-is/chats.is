import { Metadata } from 'next';

import { ModelsSettings } from '@/components/console/settings/models';

export const metadata: Metadata = {
  title: 'Models Settings'
};

export default function Page() {
  return <ModelsSettings />;
}
