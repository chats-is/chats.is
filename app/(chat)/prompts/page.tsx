import { Metadata } from 'next';

import { PromptsView } from '@/components/prompts-view';

export const metadata: Metadata = {
  title: 'Prompts'
};

export default function Page() {
  return <PromptsView />;
}
