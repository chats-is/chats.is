import { type LanguageModelUsage } from 'ai';
import { type UsageData } from 'tokenlens/helpers';

import { type Artifact, type ArtifactType } from './artifact';

// Server-merged usage: base usage + TokenLens summary + optional modelId
export type Usage = LanguageModelUsage & UsageData & { modelId?: string };

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
  /** The user already has as many replies being written as they may. */
  | 'busy'
  /** The model or its provider no longer resolves. */
  | 'model-unavailable'
  /** The stream failed part-way; whatever had been written is all there is. */
  | 'incomplete';

export type CustomUIDataTypes = {
  chat: { title: string };
  usage: Usage;
  /**
   * A refusal, persisted as part of the assistant turn.
   *
   * Written non-transiently (unlike the artifact stream parts) precisely so it
   * lands in `message.parts` and survives a reload — a refusal the user cannot
   * see afterwards leaves an unanswered message and no explanation.
   */
  error: { kind: ChatErrorKind; message: string };
  appendMessage: string;
  artifact: Artifact;
  textDelta: {
    id: string;
    delta: string;
    mode?: 'append' | 'replace';
    title?: string;
    artifactType: ArtifactType;
  };
  codeDelta: {
    id: string;
    delta: string;
    mode?: 'append' | 'replace';
    title?: string;
    language?: string;
    artifactType: ArtifactType;
  };
  messageId: string;
  id: string;
  title: {
    id: string;
    title: string;
  };
  kind: {
    id: string;
    kind: 'text' | 'code' | 'sheet';
    artifactType: ArtifactType;
  };
  clear: {
    id: string;
  };
  finish: {
    id: string;
  };
  /** An artifact that streamed onto the canvas but was never kept. */
  discard: {
    id: string;
  };
  /**
   * The artifact a reader's message is about, sent with it unseen — with a
   * code's error, or with a request about a passage they selected in it.
   * The message shows the reader's text, and the passage; they need not
   * know an "artifact" from a preview, and the model is told the rest (the
   * chat route's `convertDataPart`).
   */
  artifactRef: {
    id: string;
    /** The passage selected, as it stands in the artifact. */
    selection?: string;
  };
};
