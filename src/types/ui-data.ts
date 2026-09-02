import type { LanguageModelUsage } from 'ai'
import type { UsageData } from 'tokenlens/helpers'

import type { Artifact, ArtifactType } from './artifact'

// Server-merged usage: base usage + TokenLens summary + optional modelId
export type Usage = LanguageModelUsage & UsageData & { modelId?: string }

/**
 * Why a turn was refused. Carried on the persisted error part so the UI can
 * treat the cases differently later (a quota block wants a countdown, an
 * unpriced model wants a link to the console) without re-parsing prose, and so
 * refusals can be counted by cause.
 */
export type ChatErrorKind =
  /** No pricing row for the model, or a required rate is unset. */
  | 'pricing'
  /** The user's quota window is exhausted. */
  | 'quota'
  /** The user's quota does not list this model. */
  | 'model-access'
  /** The model or its provider no longer resolves. */
  | 'model-unavailable'
  /** The stream failed part-way; whatever had been written is all there is. */
  | 'incomplete'

export type CustomUIDataTypes = {
  chat: { title: string }
  usage: Usage
  /**
   * A refusal, persisted as part of the assistant turn.
   *
   * Written non-transiently (unlike the artifact stream parts) precisely so it
   * lands in `message.parts` and survives a reload — a refusal the user cannot
   * see afterwards leaves an unanswered message and no explanation.
   */
  error: { kind: ChatErrorKind; message: string }
  appendMessage: string
  artifact: {
    artifact: Artifact
  }
  textDelta: {
    id: string
    delta: string
    mode?: 'append' | 'replace'
    status?: 'streaming' | 'done'
    title?: string
    artifactType: ArtifactType
  }
  codeDelta: {
    id: string
    delta: string
    mode?: 'append' | 'replace'
    status?: 'streaming' | 'done'
    title?: string
    language?: string
    artifactType: ArtifactType
  }
  imageDelta: {
    id: string
    url: string
    status?: 'streaming' | 'done'
    title?: string
    artifactType: ArtifactType
  }
  fileDelta: {
    id: string
    url: string
    status?: 'streaming' | 'done'
    title?: string
    fileName?: string | null
    mimeType?: string | null
    size?: number | null
    artifactType: ArtifactType
  }
  messageId: string
  id: string
  title: {
    id: string
    title: string
  }
  kind: {
    id: string
    kind: 'text' | 'code' | 'image' | 'sheet' | 'file'
    artifactType: ArtifactType
  }
  clear: {
    id: string
  }
  finish: {
    id: string
  }
}
