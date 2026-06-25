import { Metadata } from 'next';

import { LibraryView } from '@/components/library-view';

export const metadata: Metadata = {
  title: 'Library'
};

export default function Page() {
  return <LibraryView />;
}
