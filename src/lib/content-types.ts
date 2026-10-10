import { LibraryBig, MessageSquare, SquareSparkles } from 'lucide-react';

export const contentTypes = [
  { type: 'chat', label: 'New Chat', icon: MessageSquare, path: '/' },
  { type: 'library', label: 'Library', icon: LibraryBig, path: '/library' },
  { type: 'prompts', label: 'Prompts', icon: SquareSparkles, path: '/prompts' }
] as const;
