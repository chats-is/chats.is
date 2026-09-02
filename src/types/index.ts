export { messageSchema } from './message'
export type { MessageMetadata, ChatMessage } from './message'
export type { ChatErrorKind, CustomUIDataTypes, Usage } from './ui-data'
export { attachmentSchema } from './attachment'
export type { Attachment } from './attachment'

/**
 * The signed-in user as the app sees it. Stated here rather than derived from
 * the auth library, so the shape the app depends on is the app's own.
 */
export type User = {
  id: string
  admin: boolean
  name: string
  email: string
  image?: string | null
}
export { chatTypeSchema } from './chat'
export type { Chat, ChatType } from './chat'
export type { SystemSettings, SystemDefaults } from './system-settings'
export type {
  Model,
  ModelCapability,
  ModelUIOptions,
  ModelAPIParams,
  ModelProvider,
} from './model'
export type {
  ProviderConfig,
  ProviderType,
  VertexAuthMode,
  VertexServiceAccountKey,
} from './provider'
export type { Result } from './result'
export type { SharedLink } from './shared-link'
export { artifactTypeSchema } from './artifact'
export type { Artifact, ArtifactType } from './artifact'
export {
  createArtifactInputSchema,
  generateImageInputSchema,
  editImageInputSchema,
  editVideoInputSchema,
  generateVideoInputSchema,
  textToSpeechInputSchema,
  transcribeAudioInputSchema,
  mediaToolNames,
} from './chat-tools'
export type {
  ChatTools,
  CreateArtifactInput,
  MediaToolName,
  MediaToolOutput,
  ToolErrorOutput,
  TranscribeToolOutput,
} from './chat-tools'
export type {
  PricingRecord,
  ChatUsage,
  PriceSnapshot,
  PricingSource,
  PricingSyncResult,
} from './pricing'
export type { ResolvedSource, UserQuota } from './quota'
export type {
  RecordChatUsageInput,
  RecordImageUsageInput,
  RecordVideoUsageInput,
  RecordAudioUsageInput,
  RecordTranscriptionUsageInput,
  UsageRow,
  UsageKpi,
  UserUsageRow,
  UserUsageKpi,
  UsageRowLike,
  DailyGroup,
  DailyDay,
} from './usage'
