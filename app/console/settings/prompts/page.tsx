import { Metadata } from 'next';

import { PromptsSettings } from '@/components/console/settings/prompts';

export const metadata: Metadata = {
  title: 'Prompts Settings'
};

export default function Page() {
  return <PromptsSettings />;
}
