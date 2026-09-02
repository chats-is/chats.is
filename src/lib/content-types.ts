import { LibraryBig, MessageSquare, Sparkles } from 'lucide-react'

export const contentTypes = [
  { type: 'chat', label: 'New Chat', icon: MessageSquare, path: '/' },
  { type: 'library', label: 'Library', icon: LibraryBig, path: '/library' },
  { type: 'prompts', label: 'Prompts', icon: Sparkles, path: '/prompts' },
] as const
