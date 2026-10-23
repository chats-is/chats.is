export { messageSchema } from './message';
export type { MessageMetadata, ChatMessage } from './message';
export type { ChatErrorKind, CustomUIDataTypes, Usage } from './ui-data';
export { attachmentSchema } from './attachment';
export type { Attachment } from './attachment';

/**
 * The signed-in user as the app sees it. Stated here rather than derived from
 * the auth library, so the shape the app depends on is the app's own.
 */
export type User = {
  id: string;
  admin: boolean;
  name: string;
  email: string;
  image?: string | null;
};
export type { Chat } from './chat';
export type { SystemSettings, SystemDefaults } from './system-settings';
export type {
  Model,
  ModelCapability,
  ModelUIOptions,
  ModelAPIParams,
  ModelProvider,
  ReasoningEffort,
  SentEffort
} from './model';
export type {
  Candidate,
  Provider,
  ProviderConfig,
  ProviderType,
  VertexAuthMode,
  VertexServiceAccountKey
} from './provider';
export type { Result } from './result';
export type { SharedLink } from './shared-link';
export { artifactTypeSchema } from './artifact';
export type {
  Artifact,
  ArtifactFile,
  ArtifactType,
  PreviewPackage
} from './artifact';
export type { DocumentText } from './document';
export {
  createArtifactInputSchema,
  updateArtifactInputSchema,
  generateImageInputSchema,
  editImageInputSchema,
  removeBackgroundInputSchema,
  editVideoInputSchema,
  generateVideoInputSchema,
  textToSpeechInputSchema,
  transcribeAudioInputSchema,
  webSearchInputSchema,
  xSearchInputSchema
} from './chat-tools';
export type {
  ChatTools,
  CreateArtifactInput,
  UpdateArtifactInput,
  MediaToolName,
  MediaToolOutput,
  MediaToolsOptions,
  ToolErrorOutput,
  TranscribeToolOutput,
  WebSearchToolOutput
} from './chat-tools';
export type {
  PricingRecord,
  ChatUsage,
  PriceSnapshot,
  PricingSource,
  PricingSyncResult
} from './pricing';
export type { ResolvedSource, UserQuota } from './quota';
export type { UserTier } from './tier';
export type {
  ProviderRequest,
  RecordChatUsageInput,
  RecordImageUsageInput,
  RecordVideoUsageInput,
  RecordAudioUsageInput,
  RecordTranscriptionUsageInput,
  UsageRowLike
} from './usage';
