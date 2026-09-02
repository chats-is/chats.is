import { z } from 'zod'

import type { Artifact } from './artifact'
import type { ChatMessage } from './message'

export const chatTypeSchema = z.enum(['chat', 'audio', 'image', 'video'])
export type ChatType = z.infer<typeof chatTypeSchema>

export type Chat = {
  id: string
  title: string
  type: ChatType
  modelId: string
  activeStreamId?: string | null
  messages: ChatMessage[]
  artifacts?: Artifact[]
  createdAt: Date
  updatedAt: Date
}
