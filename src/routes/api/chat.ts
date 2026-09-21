import { createFileRoute } from '@tanstack/react-router';
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  JsonToSseTransformStream,
  parsePartialJson,
  smoothStream,
  streamText,
  tool,
  UI_MESSAGE_STREAM_HEADERS
} from 'ai';
import { type z } from 'zod';

import {
  createArtifactInputSchema,
  type Artifact,
  type ChatErrorKind,
  type ChatMessage,
  type ChatUsage,
  type MessageMetadata,
  type Provider,
  type User
} from '@/types';
import { chatRequestSchema } from '@/types/chat';
import {
  artifactKindFromType,
  assertArtifactPayload,
  type ArtifactKind
} from '@/lib/artifact';
import { maskUnsupportedFileParts } from '@/lib/chat-media-urls';
import { sanitizeTitle, titleInputFromMessage } from '@/lib/chat-title';
import { normalizeChatUsage, sumChatUsage } from '@/lib/chat-usage';
import { ArtifactSystemPrompt } from '@/lib/constant';
import { fitToContext } from '@/lib/context-window';
import { pickEffort } from '@/lib/media-options';
import {
  AllProvidersFailedError,
  getLanguageModel,
  isRetryableProviderError,
  PROVIDER_FAILURE_MESSAGE
} from '@/lib/provider';
import { getResumableStreamContext } from '@/lib/resumable-stream';
import { openedWithError } from '@/lib/stream-failover';
import { BASE_SYSTEM_PROMPT } from '@/lib/system-prompt';
import { estimateTokens } from '@/lib/token-estimate';
import {
  convertToChatMessages,
  formatLocalTime,
  formatString,
  generateUUID
} from '@/lib/utils';
import { authedRequest } from '@/server/middleware';
import { carriesOnlyOwnFiles } from '@/server/services/blob';
import * as chats from '@/server/services/chat';
import { buildMediaTools } from '@/server/services/chat-tools';
import * as messages from '@/server/services/message';
import { findModelByModelId } from '@/server/services/model';
import { preflightCheck } from '@/server/services/preflight';
import { getSystemPrompt, getTitleSettings } from '@/server/services/settings';
import { recordChatUsage } from '@/server/services/usage';

export const Route = createFileRoute('/api/chat')({
  server: {
    middleware: [authedRequest],
    handlers: { POST, GET, DELETE }
  }
});

/**
 * The generations this process is running, by chat, so a Stop that lands here
 * takes effect at once. It is a shortcut and not the mechanism: a Stop may
 * just as well reach another process, which is why each generation also checks
 * that it still holds its chat (see `chats.isGenerating`).
 */
const running = new Map<string, AbortController>();

/** How long naming a chat may take before the chat simply stays unnamed. */
const TITLE_TIMEOUT_MS = 15_000;

/** How often a generation checks that it has not been stopped from elsewhere. */
const STOP_CHECK_MS = 1500;

/**
 * What the user is shown when a generation fails: the provider's own words
 * where there are any. Both the inner `toUIMessageStream` and the outer
 * `createUIMessageStream` need it — whichever sees the failure first writes
 * the message part, and a default on either one swallows the reason.
 */
function streamErrorMessage(error: unknown): string {
  if (error == null) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

// Verbose error serializer — resumable-stream / node-redis failures often
// surface as empty `Error` objects, so dig out name/code/cause/aggregate to
// make the real reason visible.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  const e = err as Error & {
    code?: unknown;
    errors?: unknown[];
    cause?: unknown;
  };
  const parts = [`${e.name}: ${e.message || '(no message)'}`];
  if (e.code != null) parts.push(`code=${String(e.code)}`);
  if (Array.isArray(e.errors)) {
    parts.push(
      `aggregate=[${e.errors
        .map(x => (x instanceof Error ? `${x.name}: ${x.message}` : String(x)))
        .join(' | ')}]`
    );
  }
  if (e.cause != null) {
    parts.push(
      `cause=${e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : String(e.cause)}`
    );
  }
  if (e.stack) parts.push(`\n${e.stack}`);
  return parts.join(' ');
}

async function POST({
  request: req,
  context
}: {
  request: Request;
  context: { user: User };
}) {
  const { user } = context;

  // A body that is not JSON parses to nothing, and fails the schema with the
  // rest of what it refuses.
  const parsed = chatRequestSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { id, modelId, isReasoning, effort, timeZone, language, mediaOptions } =
    parsed.data;
  // The schema has settled the shape; the parts are typed by the tools and
  // data this app defines, which a wire schema cannot name one by one.
  const sent = parsed.data.userMessage as ChatMessage & { role: 'user' };

  // A message already stored under this id is being answered again — a
  // regenerate, a retry, an edit resent. Decided by the row rather than by
  // what the request says it is, and the row is also what is answered: an
  // edit is saved through its own endpoint before it is resent, so the stored
  // parts are the current ones, and what the body repeats is not re-examined.
  // That matters for an old message whose attachment predates this store —
  // it could never pass the check below, and would make its chat impossible
  // to regenerate.
  const stored = await messages.findUserMessage(user.id, {
    chatId: parsed.data.id,
    messageId: sent.id
  });

  // A new message is held to what a user may send. The schema could only ask
  // whether an attachment is in a blob store; here it can be asked whether it
  // is in ours. Kept out, a file from anywhere else is an address this server
  // and the provider would both go and fetch.
  if (!stored && !carriesOnlyOwnFiles(sent.parts)) {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // Stamped here, not by the sender: when a message was sent decides what a
  // later regenerate cuts away, and a time taken from the request would let
  // the request choose.
  const userMessage: ChatMessage & { role: 'user' } = stored
    ? { ...sent, parts: stored.parts }
    : { ...sent, metadata: { parentId: sent.metadata?.parentId } };

  // Fetch model from database to validate
  const dbModel = await findModelByModelId(modelId, 'chat');
  const candidates = dbModel?.providers.map(binding => binding.provider!) ?? [];

  // A refusal is not returned as an HTTP error: it is persisted as the
  // assistant turn, so the user still sees why when they come back to the
  // conversation. Decided up front, but acted on after the user's message is
  // stored — the refusal has to attach to something.
  let refusal: { kind: ChatErrorKind; message: string } | null = null;

  if (!dbModel || candidates.length === 0) {
    console.error(`[chat] model unavailable: ${modelId}`);
    refusal = {
      kind: 'model-unavailable',
      message:
        'This model is currently unavailable. Please choose a different model.'
    };
  } else {
    const gate = await preflightCheck({
      userId: user.id,
      modelKey: dbModel.modelId,
      modelLabel: dbModel.name,
      capability: 'chat'
    });
    if (!gate.ok) {
      // Keep the cause greppable in the logs now that the status code no
      // longer carries it.
      console.warn(`[chat] refused (${gate.kind}): ${gate.message}`);
      refusal = { kind: gate.kind, message: gate.message };
    }
  }

  // No type filter: continuing a legacy media chat reuses its row.
  const chat = await chats.getChat(user.id, {
    id,
    includeMessages: false,
    includeArtifacts: false
  });
  const UNTITLED = 'Untitled';
  const title = chat?.title ?? UNTITLED;

  /**
   * Title from the first user message. Skipped for a refused turn — it calls a
   * model, and spending on a reply that will never happen is wrong in general
   * and self-defeating for a quota refusal.
   */
  const generateTitle = async () => {
    if (refusal) return UNTITLED;
    try {
      const {
        prompt: titlePrompt,
        modelId: titleModelId,
        provider: titleProvider
      } = await getTitleSettings();

      if (!titlePrompt || !titleModelId || !titleProvider) return UNTITLED;

      // Only what the user wrote, with attachments named rather than linked —
      // `titleInputFromMessage` explains what the raw message did to a model
      // whose one job is to name the conversation.
      const input = titleInputFromMessage(userMessage);
      if (!input) return UNTITLED;

      const { text, usage } = await generateText({
        model: getLanguageModel(titleProvider, titleModelId),
        instructions: titlePrompt,
        prompt: input,
        // The reply's stream is held open for this, and the reply is stored
        // when that stream ends — so a title provider that hangs would hold
        // back the storing of a reply that finished long ago. A name is a
        // nicety; it gets a few seconds and no retries.
        abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
        maxRetries: 0
      });

      // A generation like any other, and recorded like one: it is a call to a
      // priced model made on this user's behalf, and the usage table is where
      // an operator reads what their keys were spent on.
      await recordChatUsage({
        userId: user.id,
        chatId: id,
        messageId: userMessage.id,
        modelId: titleModelId,
        providerId: titleProvider.id,
        usage: normalizeChatUsage(usage)
      });

      return sanitizeTitle(text) || UNTITLED;
    } catch (err: any) {
      console.error(`Generate title error:`, err.message);
      return UNTITLED;
    }
  };

  if (!chat) {
    await chats.createChat(user.id, {
      id,
      title,
      type: 'chat',
      modelId,
      messages: [userMessage]
    });
  }

  // The chat exists now, so it can be claimed. A turn that would be refused
  // anyway claims nothing; one that is refused here is refused for having too
  // many others running, which only the claim can tell.
  const streamId = generateUUID();
  if (!refusal) {
    const claimed = await chats.beginGeneration(user.id, {
      chatId: id,
      streamId
    });
    if (!claimed) {
      console.warn(`[chat] refused (busy): user=${user.id}`);
      refusal = {
        kind: 'busy',
        message:
          'Several replies are already being written for you. Wait for one to finish, then try again.'
      };
    }
  }

  // From here the claim is held, and nothing may leave without letting it go.
  let titleTask: Promise<string> | null = null;
  try {
    if (chat && !stored) {
      await messages.createMessages(user.id, {
        chatId: id,
        messages: [userMessage]
      });
    } else if (stored && !refusal) {
      // Only now, with the turn certain to go ahead. Cutting a chat back is
      // not undone — the later messages go, and their files with them — so it
      // is not done for a turn that is about to be refused: someone over
      // their quota who pressed Regenerate would have lost the rest of the
      // conversation and been given a refusal for it.
      await messages.truncateAfter(user.id, {
        chatId: id,
        messageId: userMessage.id
      });
    }

    // Naming the chat is a model call of its own, and nothing about the reply
    // depends on its answer — so it is started here and read once the reply
    // is under way, rather than standing between the user and the first token.
    //
    // Tried while the chat is young and then let be. A chat is still unnamed
    // after that because the title model cannot name it — no model
    // configured, a provider that is down — and asking again on every turn
    // for the life of the chat is a paid call that keeps failing.
    titleTask =
      title === UNTITLED &&
      !refusal &&
      (!chat || (await messages.countUserMessages(user.id, id)) <= 2)
        ? generateTitle()
        : null;
  } catch (err) {
    if (!refusal) await chats.endGeneration(id, streamId).catch(() => {});
    throw err;
  }

  // The user's message is stored, so the refusal now has a turn to attach to.
  // Sent as a normal (200) message stream rather than a 4xx: useChat treats a
  // non-2xx as a transport failure and never reads the body, so a refusal
  // delivered that way could not become part of the conversation. The cause is
  // logged above to keep it visible where the status code used to carry it.
  // `!dbModel` is one of the conditions that sets `refusal`; testing it again
  // here is what narrows dbModel for everything below.
  if (refusal || !dbModel) {
    const data = refusal ?? {
      kind: 'model-unavailable' as const,
      message:
        'This model is currently unavailable. Please choose a different model.'
    };
    const errorMessageId = generateUUID();
    const refusedAt = new Date();
    const refusalMetadata: MessageMetadata = {
      parentId: userMessage.id,
      createdAt: refusedAt,
      updatedAt: refusedAt
    };

    const refusalStream = createUIMessageStream<ChatMessage>({
      execute: ({ writer }) => {
        // `start` carries the id and metadata, exactly as the normal path does
        // through toUIMessageStream. Without it the client invents its own id
        // and leaves metadata undefined, so the message it holds no longer
        // matches the stored row — and Retry, which reads
        // `metadata.parentId`, would re-send the user message as if it were
        // new and collide with the row already stored under that id.
        writer.write({
          type: 'start',
          messageId: errorMessageId,
          messageMetadata: refusalMetadata
        });
        // Before data-chat: the client's data-chat handler clears the
        // optimistic-model ref as a success signal, and the refusal handler
        // needs that ref to put the selector back.
        writer.write({ type: 'data-error', data });
        // The chat may have just been created; the client watches for this to
        // put the id in the URL and refresh the sidebar. Transient for the same
        // reason as the normal path — a signal, not content.
        writer.write({
          type: 'data-chat',
          data: { title },
          transient: true
        });
      },
      generateId: () => errorMessageId,
      onEnd: async ({ responseMessage }) => {
        if (!responseMessage) return;
        // A refused resend leaves the chat exactly as it was: the reply it
        // would have replaced is still there, and a stored refusal beside it
        // would be a second answer to one message. It is shown and let go.
        if (stored && (await messages.hasReply(user.id, userMessage.id))) {
          return;
        }
        try {
          await messages.createRefusal(user.id, {
            id: responseMessage.id || errorMessageId,
            parentId: responseMessage.metadata?.parentId ?? userMessage.id,
            chatId: id,
            parts: responseMessage.parts
          });
        } catch (err) {
          // The client has already rendered the refusal; throwing here would
          // error a response it has finished reading.
          console.error('[chat] failed to persist refusal:', err);
        }
      }
    });

    return createUIMessageStreamResponse({ stream: refusalStream });
  }

  // Set once the generation has claimed things that need letting go of.
  let cleanup: (() => Promise<void>) | null = null;

  try {
    const historyMessages = await messages.listMessages(user.id, id);
    const chatMessages = convertToChatMessages(historyMessages);

    let reasonStartedAt: Date | null = null;
    let reasonDuration = 0;
    const assistantMessageId = generateUUID();

    // Independent setup queries — run concurrently to keep time-to-first-token
    // down (media tool resolution should not delay plain text chats).
    const [systemPromptContent, mediaTools] = await Promise.all([
      getSystemPrompt(dbModel.systemPrompt),
      buildMediaTools({
        userId: user.id,
        chatId: id,
        assistantMessageId,
        mediaOptions,
        chatMessages
      })
    ]);
    // Only the app's own part is a template. What an admin wrote, and what
    // the model carries, follow it verbatim.
    const systemMessage = [
      formatString(BASE_SYSTEM_PROMPT, {
        provider: dbModel.providers[0]?.provider?.name || '',
        modelId,
        // The server's clock, told in the user's zone. Sending their own
        // timestamp would carry their clock's errors with it; sending UTC
        // makes "today" wrong for most of the world.
        datetime: formatLocalTime(timeZone),
        language: language || ''
      }),
      systemPromptContent
    ]
      .filter((part): part is string => !!part?.trim())
      .join('\n\n');
    const completedArtifacts = new Map<string, Artifact>();
    const completedArtifactOrder: string[] = [];

    // A stream that fails part-way still persists what it had written, and the
    // SDK's error chunk never becomes a message part — so without this the
    // answer is stored truncated with nothing to say it was cut off, and the
    // user takes the fragment for the whole reply.
    let streamFailed = false;

    // Stop. The signal reaches the model call and every tool under it. It is
    // raised from here when the Stop request lands in this process, and from
    // the check below when it landed in another — or when a newer turn has
    // taken the chat over.
    const stopper = new AbortController();
    running.set(id, stopper);
    const stopCheck = setInterval(() => {
      chats
        .isGenerating(id, streamId)
        .then(held => {
          if (!held) stopper.abort();
        })
        // A failed check is not a Stop. The next one asks again.
        .catch(() => {});
    }, STOP_CHECK_MS);
    const release = async () => {
      clearInterval(stopCheck);
      if (running.get(id) === stopper) running.delete(id);
      await chats.endGeneration(id, streamId).catch(() => {});
    };
    cleanup = release;

    // Roughly what the model was sent, for charging a step that was stopped
    // before the provider could say (see the outer `onEnd`).
    let promptTokens = 0;

    // What each step of the turn used, and the provider that served them.
    const spent: ChatUsage[] = [];
    let servedBy: Provider | null = null;
    // The provider the stream was handed to, known before any step ends.
    let lastCandidate: Provider | null = null;
    const recordStreamError = (error: unknown) => {
      const message = streamErrorMessage(error);
      streamFailed = true;
      console.error(`[chat] stream failed for chat=${id}:`, message);
      return message;
    };

    const stream = createUIMessageStream<ChatMessage>({
      execute: async ({ writer }) => {
        /**
         * Write a part the client reacts to but the message should not keep.
         *
         * Transient parts still reach `onData`, they are just not accumulated
         * into `message.parts`. Used for anything that is a signal rather than
         * content: the artifact deltas driving the live canvas (thousands per
         * artifact, and the artifact itself is persisted to its own table), the
         * chat title (already a column on the chat row), and the assistant
         * message id (which the message would otherwise carry inside itself).
         */
        const emitTransient = (part: Parameters<typeof writer.write>[0]) =>
          writer.write({
            ...part,
            transient: true
          } as Parameters<typeof writer.write>[0]);

        const emitArtifactDelta = (artifact: Artifact) => {
          emitTransient({ type: 'data-id', data: artifact.id });
          const kind = artifactKindFromType(artifact.type);
          emitTransient({
            type: 'data-title',
            data: { id: artifact.id, title: artifact.title }
          });
          emitTransient({
            type: 'data-kind',
            data: {
              id: artifact.id,
              kind,
              artifactType: artifact.type
            }
          });
          emitTransient({
            type: 'data-clear',
            data: { id: artifact.id }
          });
          if (['code', 'json', 'html'].includes(artifact.type)) {
            emitTransient({
              type: 'data-codeDelta',
              data: {
                id: artifact.id,
                title: artifact.title,
                delta: artifact.content ?? '',
                mode: 'replace',
                status: 'done',
                language: artifact.language ?? undefined,
                artifactType: artifact.type
              }
            });
            emitTransient({
              type: 'data-finish',
              data: { id: artifact.id }
            });
            return;
          }
          if (artifact.type === 'image' && artifact.fileUrl) {
            emitTransient({
              type: 'data-imageDelta',
              data: {
                id: artifact.id,
                title: artifact.title,
                url: artifact.fileUrl,
                status: 'done',
                artifactType: artifact.type
              }
            });
            emitTransient({
              type: 'data-finish',
              data: { id: artifact.id }
            });
            return;
          }
          if (artifact.type === 'file' && artifact.fileUrl) {
            emitTransient({
              type: 'data-fileDelta',
              data: {
                id: artifact.id,
                title: artifact.title,
                url: artifact.fileUrl,
                fileName: artifact.fileName ?? null,
                mimeType: artifact.mimeType ?? null,
                size: artifact.size ?? null,
                status: 'done',
                artifactType: artifact.type
              }
            });
            emitTransient({
              type: 'data-finish',
              data: { id: artifact.id }
            });
            return;
          }
          emitTransient({
            type: 'data-textDelta',
            data: {
              id: artifact.id,
              title: artifact.title,
              delta: artifact.content ?? '',
              mode: 'replace',
              status: 'done',
              artifactType: artifact.type
            }
          });
          emitTransient({
            type: 'data-finish',
            data: { id: artifact.id }
          });
        };

        const createArtifactSchema = createArtifactInputSchema;
        type CreateArtifactInput = z.infer<typeof createArtifactSchema>;

        const createArtifactRecord = (
          input: CreateArtifactInput,
          artifactId: string
        ): Artifact => {
          const now = new Date();

          return {
            id: artifactId,
            chatId: id,
            messageId: assistantMessageId,
            title: input.title,
            type: input.type,
            language: input.language ?? null,
            content: input.content ?? null,
            fileUrl: input.fileUrl ?? null,
            fileName: input.fileName ?? null,
            mimeType: input.mimeType ?? null,
            size: input.size ?? null,
            status: 'done',
            createdAt: now,
            updatedAt: now
          };
        };

        type ToolArtifactStreamState = {
          artifactId: string;
          rawInput: string;
          started: boolean;
          lastTitle: string;
          lastKind: ArtifactKind;
          lastType?: CreateArtifactInput['type'];
          lastContent: string;
          lastUrl: string | null;
          lastFileName: string | null;
          lastMimeType: string | null;
          lastSize: number | null;
        };

        const toolArtifactStates = new Map<string, ToolArtifactStreamState>();

        const emitToolArtifactUpdate = async (toolCallId: string) => {
          const state = toolArtifactStates.get(toolCallId);
          if (!state) return;

          const { value } = await parsePartialJson(state.rawInput);
          const input = (value ?? {}) as Partial<CreateArtifactInput>;
          const artifactType = input.type;
          if (!artifactType) return;
          const title = input.title?.trim() || 'Untitled';
          const kind = artifactKindFromType(artifactType);

          if (!state.started) {
            emitTransient({ type: 'data-id', data: state.artifactId });
            emitTransient({
              type: 'data-title',
              data: { id: state.artifactId, title }
            });
            emitTransient({
              type: 'data-kind',
              data: {
                id: state.artifactId,
                kind,
                artifactType
              }
            });
            emitTransient({
              type: 'data-clear',
              data: { id: state.artifactId }
            });
            state.started = true;
            state.lastTitle = title;
            state.lastKind = kind;
            state.lastType = artifactType;
          } else {
            if (title !== state.lastTitle) {
              emitTransient({
                type: 'data-title',
                data: { id: state.artifactId, title }
              });
              state.lastTitle = title;
            }
            if (kind !== state.lastKind || artifactType !== state.lastType) {
              emitTransient({
                type: 'data-kind',
                data: {
                  id: state.artifactId,
                  kind,
                  artifactType
                }
              });
              state.lastKind = kind;
              state.lastType = artifactType;
            }
          }

          if (kind === 'code' || kind === 'sheet' || kind === 'text') {
            const nextContent = input.content ?? '';
            if (nextContent !== state.lastContent) {
              const isAppend = nextContent.startsWith(state.lastContent);
              const delta = isAppend
                ? nextContent.slice(state.lastContent.length)
                : nextContent;

              emitTransient({
                type:
                  kind === 'code' || kind === 'sheet'
                    ? 'data-codeDelta'
                    : 'data-textDelta',
                data: {
                  id: state.artifactId,
                  title,
                  delta,
                  mode: isAppend ? 'append' : 'replace',
                  status: 'streaming',
                  artifactType,
                  ...(kind === 'code' || kind === 'sheet'
                    ? {
                        language:
                          artifactType === 'json'
                            ? 'json'
                            : (input.language ?? undefined)
                      }
                    : {})
                }
              });
              state.lastContent = nextContent;
            }
            return;
          }

          if (
            kind === 'image' &&
            input.fileUrl &&
            input.fileUrl !== state.lastUrl
          ) {
            emitTransient({
              type: 'data-imageDelta',
              data: {
                id: state.artifactId,
                title,
                url: input.fileUrl,
                status: 'streaming',
                artifactType
              }
            });
            state.lastUrl = input.fileUrl;
            return;
          }

          if (kind === 'file') {
            const nextUrl = input.fileUrl ?? null;
            const nextFileName = input.fileName ?? null;
            const nextMimeType = input.mimeType ?? null;
            const nextSize = input.size ?? null;

            if (
              nextUrl &&
              (nextUrl !== state.lastUrl ||
                nextFileName !== state.lastFileName ||
                nextMimeType !== state.lastMimeType ||
                nextSize !== state.lastSize)
            ) {
              emitTransient({
                type: 'data-fileDelta',
                data: {
                  id: state.artifactId,
                  title,
                  url: nextUrl,
                  fileName: nextFileName,
                  mimeType: nextMimeType,
                  size: nextSize,
                  status: 'streaming',
                  artifactType
                }
              });
              state.lastUrl = nextUrl;
              state.lastFileName = nextFileName;
              state.lastMimeType = nextMimeType;
              state.lastSize = nextSize;
            }
          }
        };

        const artifactTools = {
          create_artifact: tool({
            description:
              'Create a new artifact (code, markdown, html, json, text, image, or file).',
            inputSchema: createArtifactSchema,
            onInputStart: ({ toolCallId }) => {
              toolArtifactStates.set(toolCallId, {
                artifactId: generateUUID(),
                rawInput: '',
                started: false,
                lastTitle: 'Untitled',
                lastKind: 'text',
                lastType: undefined,
                lastContent: '',
                lastUrl: null,
                lastFileName: null,
                lastMimeType: null,
                lastSize: null
              });
            },
            onInputDelta: async ({ toolCallId, inputTextDelta }) => {
              const state = toolArtifactStates.get(toolCallId);
              if (!state) return;
              state.rawInput += inputTextDelta;
              await emitToolArtifactUpdate(toolCallId);
            },
            execute: async (input, options?: { toolCallId?: string }) => {
              assertArtifactPayload(input);
              const streamState = options?.toolCallId
                ? toolArtifactStates.get(options.toolCallId)
                : undefined;
              const artifactId =
                streamState?.artifactId ?? input.id ?? generateUUID();
              const artifact = createArtifactRecord(input, artifactId);
              if (!completedArtifacts.has(artifact.id)) {
                completedArtifactOrder.push(artifact.id);
              }
              completedArtifacts.set(artifact.id, artifact);
              if (!streamState?.started) {
                emitArtifactDelta(artifact);
              } else {
                emitTransient({
                  type: 'data-finish',
                  data: { id: artifact.id }
                });
              }
              emitTransient({
                type: 'data-artifact',
                data: { artifact }
              });
              if (options?.toolCallId) {
                toolArtifactStates.delete(options.toolCallId);
              }

              return { id: artifact.id };
            }
          })
        };

        // Transient: both are signals for the client (title/URL/sidebar, and
        // associating artifacts with this message), not content. Accumulating
        // them would store the title on every assistant message — the chat row
        // already has it — and the message's own id inside its own parts.
        emitTransient({ type: 'data-chat', data: { title } });
        emitTransient({ type: 'data-messageId', data: assistantMessageId });

        // Media the chat model can't consume (audio/video always, images on
        // non-vision models) becomes text markers carrying the URL, so the
        // model can still reference them via the media tools.
        const instructions = [
          systemMessage,
          ArtifactSystemPrompt,
          mediaTools.systemPrompt
        ]
          .filter(Boolean)
          .join('\n\n');

        // A chat longer than the model can take is sent without its
        // beginning rather than refused for the rest of its life. Only when
        // the operator has said how much the model takes: there are eight
        // providers' worth of models behind this, and no list of their limits
        // that stays true.
        const budget = dbModel.apiParams?.maxInputTokens;
        const fitted = budget
          ? fitToContext(chatMessages, budget - estimateTokens(instructions))
          : { messages: chatMessages, dropped: 0 };
        if (fitted.dropped > 0) {
          console.warn(
            `[chat] chat=${id} outgrew ${modelId}: sent without its first ${fitted.dropped} messages`
          );
        }

        const modelMessages = await convertToModelMessages(
          maskUnsupportedFileParts(fitted.messages, {
            supportsVision: dbModel.supportsVision
          }),
          // A turn cut short mid-call is stored with the call and no result,
          // and a call without a result is refused outright — by the SDK, and
          // by the providers behind it. Left in, one interrupted turn would
          // fail every turn after it in that chat.
          { ignoreIncompleteToolCalls: true }
        );
        promptTokens =
          estimateTokens(instructions) +
          estimateTokens(JSON.stringify(modelMessages));

        const buildStream = (failoverProvider: Provider) =>
          streamText({
            model: getLanguageModel(failoverProvider, modelId),
            abortSignal: stopper.signal,
            instructions,
            messages: modelMessages,
            tools: { ...artifactTools, ...mediaTools.tools },
            ...(failoverProvider.apiOptions && {
              providerOptions: {
                [failoverProvider.type]: failoverProvider.apiOptions
              } as any
            }),
            // The chain has already settled this against what the model
            // declared; the SDK hands it to whichever provider is behind the
            // model, so nothing here spells it that vendor's way.
            //
            // A model whose Reasoning switch is off does not think at all, so
            // there is no level to ask for — the switch is the source of
            // truth, and options left over from before it was turned off are
            // not an instruction.
            reasoning: dbModel.supportsReasoning
              ? pickEffort(undefined, effort, dbModel.uiOptions)
              : undefined,
            temperature: dbModel.apiParams?.temperature,
            topP: dbModel.apiParams?.topP,
            topK: dbModel.apiParams?.topK,
            maxOutputTokens: dbModel.apiParams?.maxOutputTokens,
            frequencyPenalty: dbModel.apiParams?.frequencyPenalty,
            presencePenalty: dbModel.apiParams?.presencePenalty,
            stopWhen: isStepCount(5),
            experimental_transform: smoothStream({ chunking: 'word' }),
            onChunk: ({ chunk }) => {
              if (chunk.type === 'reasoning-delta') {
                reasonStartedAt ??= new Date();
              }
            },
            // Kept step by step and added up when the turn is over (see the
            // outer `onEnd`). The SDK's own total exists only for a turn that
            // ended well: a step that fails after others have answered leaves
            // it empty, and those steps were paid for.
            onStepEnd: ({ warnings, usage }) => {
              if (warnings) {
                console.log('Warnings: ', warnings);
              }
              spent.push(normalizeChatUsage(usage));
              servedBy = failoverProvider;
            }
          });

        // Each candidate is read up to its first part of substance, and only
        // one that opened with a retryable error is passed over.
        let res: ReturnType<typeof buildStream> | undefined;
        const failoverAttempts: { provider: string; error: unknown }[] = [];
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          const isLast = i === candidates.length - 1;
          try {
            const attempt = buildStream(candidate);
            const failed = isLast ? undefined : await openedWithError(attempt);
            if (failed && isRetryableProviderError(failed.error)) {
              console.warn(
                `[chat] ${candidate.name} could not start, failing over —`,
                describeError(failed.error)
              );
              failoverAttempts.push({
                provider: candidate.name,
                error: failed.error
              });
              continue;
            }
            // The last candidate, or an error no other provider would answer
            // differently: the stream is used as it is, and reports itself.
            res = attempt;
            lastCandidate = candidate;
            break;
          } catch (error) {
            // Thrown while building — a credential that does not decrypt, a
            // malformed provider config. This provider cannot start at all.
            failoverAttempts.push({ provider: candidate.name, error });
            if (isLast) {
              throw error;
            }
          }
        }
        if (!res) {
          console.error(
            '[chat] every provider failed',
            failoverAttempts.map(
              attempt => `${attempt.provider}: ${describeError(attempt.error)}`
            )
          );
          throw new AllProvidersFailedError(
            PROVIDER_FAILURE_MESSAGE,
            failoverAttempts
          );
        }

        res.consumeStream();

        writer.merge(
          res.toUIMessageStream({
            originalMessages: chatMessages,
            generateMessageId: () => assistantMessageId,
            sendReasoning: isReasoning,
            // Without this the inner stream uses the SDK's default, which
            // reports every failure as "An error occurred." — the outer
            // handler never sees it, so the reason is lost before it can be
            // shown or written to the message.
            onError: recordStreamError,
            messageMetadata: ({ part }) => {
              if (part.type === 'start') {
                const now = new Date();
                const messageMetadata: MessageMetadata = {
                  parentId: userMessage.id,
                  createdAt: now,
                  updatedAt: now
                };
                return messageMetadata;
              }

              if (
                part.type === 'reasoning-start' ||
                part.type === 'reasoning-delta' ||
                part.type === 'reasoning-end'
              ) {
                const now = new Date();
                let nextReasonDuration = reasonDuration;

                if (part.type === 'reasoning-start') {
                  reasonStartedAt ??= now;
                } else if (part.type === 'reasoning-delta') {
                  reasonStartedAt ??= now;
                } else if (part.type === 'reasoning-end') {
                  if (reasonStartedAt) {
                    nextReasonDuration += Math.max(
                      0,
                      now.getTime() - reasonStartedAt.getTime()
                    );
                  }
                  reasonDuration = nextReasonDuration;
                  reasonStartedAt = null;
                }

                if (reasonStartedAt) {
                  nextReasonDuration += Math.max(
                    0,
                    now.getTime() - reasonStartedAt.getTime()
                  );
                }

                return {
                  reasonDuration: nextReasonDuration || undefined
                } satisfies Partial<MessageMetadata>;
              }
            }
          })
        );

        // The reply is streaming by now. The stream stays open until this
        // returns, so a name that arrives after a short reply still has
        // somewhere to go.
        if (titleTask) {
          const generated = await titleTask;
          if (generated !== UNTITLED) {
            try {
              await chats.updateChat(user.id, { id, title: generated });
              emitTransient({ type: 'data-chat', data: { title: generated } });
            } catch (err) {
              // A chat left unnamed is named on its next turn; failing the
              // reply over it would be the worse outcome.
              console.warn('[chat] failed to store title for', id, err);
            }
          }
        }
      },
      generateId: generateUUID,
      onEnd: async ({ responseMessage, isAborted }) => {
        // Asked before the claim is let go, since letting go erases the answer.
        const state = await chats
          .generationState(id, streamId)
          .catch(() => 'held' as const);

        try {
          await settle({ responseMessage, isAborted, state });
        } catch (err) {
          // Nothing reads what this returns: the client has the whole reply
          // already. A throw would only error a finished response.
          console.error(`[chat] failed to settle turn for chat=${id}:`, err);
        } finally {
          // Last, so the chat reads as still being written until the reply is
          // stored — a reload in between would otherwise find neither.
          await release();
        }
      },
      onError: recordStreamError
    });

    const settle = async ({
      responseMessage,
      isAborted,
      state
    }: {
      responseMessage: ChatMessage | undefined;
      isAborted: boolean;
      state: 'held' | 'stopped' | 'superseded';
    }) => {
      // A stopped step reports nothing: the provider sends its count with
      // the last chunk, and the last chunk is what was cut off. Unrecorded,
      // stopping a reply just before it finishes would make it free — so the
      // step is charged for what is known of it: what it was sent, and what
      // of the reply the finished steps do not already account for.
      if (isAborted && (servedBy ?? lastCandidate)) {
        servedBy ??= lastCandidate;
        const written = (responseMessage?.parts ?? [])
          .map(part =>
            part.type === 'text' || part.type === 'reasoning' ? part.text : ''
          )
          .join('');
        const counted = spent.reduce(
          (sum, step) =>
            sum + (step.outputTokens ?? 0) + (step.reasoningTokens ?? 0),
          0
        );
        spent.push({
          inputTokens: promptTokens,
          outputTokens: Math.max(0, estimateTokens(written) - counted)
        });
      }

      // First, and whatever became of the reply: the tokens were spent even
      // if there turns out to be no message to store.
      if (servedBy && spent.length > 0) {
        await recordChatUsage({
          userId: user.id,
          chatId: id,
          messageId: assistantMessageId,
          modelId,
          providerId: servedBy.id,
          usage: sumChatUsage(spent)
        });
      } else {
        console.warn(`[chat] no usage reported for model=${modelId}`);
      }

      const finishedAt = new Date();
      if (reasonStartedAt) {
        reasonDuration += Math.max(
          0,
          finishedAt.getTime() - reasonStartedAt.getTime()
        );
        reasonStartedAt = null;
      }

      if (responseMessage) {
        responseMessage.metadata = {
          ...responseMessage.metadata,
          reasonDuration:
            responseMessage.metadata?.reasonDuration ??
            (reasonDuration || undefined),
          createdAt: responseMessage.metadata?.createdAt ?? finishedAt,
          updatedAt: finishedAt
        };
        responseMessage.id = responseMessage.id || assistantMessageId;
      }

      if (!responseMessage) {
        return;
      }

      // A newer turn has taken this chat: cut it back, and is answering it
      // again. What this one wrote belongs to a conversation that is no
      // longer there — stored, it would sit beside the new reply as a second
      // answer, or fail for want of the message it answers. Its cost, above,
      // is real either way; its words are not kept.
      if (state === 'superseded') {
        console.warn(`[chat] turn superseded for chat=${id}; reply not stored`);
        return;
      }

      // The marker says the turn was cut short; why it was cut short is in
      // the log above, not in the thread — a provider's message means
      // nothing to the person reading this conversation next week.
      if (streamFailed) {
        responseMessage.parts = [
          ...responseMessage.parts,
          {
            type: 'data-error',
            data: {
              kind: 'incomplete',
              message: 'This response was interrupted.'
            }
          }
        ];
      }

      const persistedArtifacts = completedArtifactOrder
        .map(artifactId => completedArtifacts.get(artifactId))
        .filter((artifact): artifact is Artifact => Boolean(artifact));

      await messages.createTurn(user.id, {
        chatId: id,
        message: {
          id: responseMessage.id,
          parentId: responseMessage.metadata?.parentId ?? userMessage.id,
          role: 'assistant',
          parts: responseMessage.parts,
          reasonDuration: responseMessage.metadata?.reasonDuration,
          createdAt: responseMessage.metadata?.createdAt ?? finishedAt,
          updatedAt: responseMessage.metadata?.updatedAt ?? finishedAt
        },
        artifacts: persistedArtifacts
      });

      // Update chat model if changed
      if (chat && chat.modelId !== modelId) {
        try {
          await chats.updateChat(user.id, { id, modelId });
        } catch (err) {
          console.warn('Unable to update chat', id, err);
        }
      }
    };

    // When Redis is configured, wrap the stream as a resumable one so a page
    // refresh can re-attach to an in-progress generation (see the GET handler).
    // resumableStream drains the source into Redis, which — like consumeStream
    // below — keeps tool work, usage and persistence running past a client
    // disconnect.
    const streamContext = await getResumableStreamContext();
    if (streamContext) {
      try {
        const resumable = await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream())
        );
        if (resumable) {
          // resumable yields SSE *strings*; a Response body needs bytes, so
          // encode (createUIMessageStreamResponse does this internally).
          return new Response(resumable.pipeThrough(new TextEncoderStream()), {
            headers: UI_MESSAGE_STREAM_HEADERS
          });
        }
      } catch (err) {
        // Redis hiccup — fall back to a normal one-shot stream below rather
        // than failing the whole request.
        console.warn(
          '[chat] resumable stream unavailable, falling back —',
          describeError(err)
        );
      }
    }

    // consumeSseStream keeps a tee'd copy flowing server-side so tool work,
    // usage records and message persistence complete even when the client
    // disconnects mid-stream (otherwise usage is billed but the assistant
    // message is never saved).
    return createUIMessageStreamResponse({
      stream,
      consumeSseStream: consumeStream
    });
  } catch (err: any) {
    console.error('Chat error:', err);
    // Nothing will reach the stream's own `onEnd`, so the claim is let go here.
    if (cleanup) await cleanup();
    else await chats.endGeneration(id, streamId).catch(() => {});
    return Response.json(
      { error: 'Oops, an error occurred!' },
      { status: 500 }
    );
  }
}

/**
 * Resume an in-progress chat generation after a page refresh. The client
 * (useChat `resume: true`) calls this with `?chatId=`; we re-attach to the most
 * recent resumable stream recorded for that chat. Returns 204 when resume is
 * disabled (no REDIS_URL), the chat isn't the caller's, or the stream already
 * finished — in which case the final message is already persisted in the DB.
 */
async function GET({
  request: req,
  context
}: {
  request: Request;
  context: { user: User };
}) {
  const { user } = context;

  const streamContext = await getResumableStreamContext();
  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  const chatId = new URL(req.url).searchParams.get('chatId');
  if (!chatId) {
    return Response.json({ error: 'chatId is required' }, { status: 400 });
  }

  // Only the chat owner may resume, and only if it has an active stream.
  const streamId = await chats.getStreamId(user.id, chatId);
  if (!streamId) {
    return new Response(null, { status: 204 });
  }

  // resumeExistingStream returns null/undefined once the stream has finished or
  // expired, in which case the final message is already persisted and the
  // client uses that. A Redis blip must not turn a reconnect into a 500 — since
  // resume fires on every chat mount, swallow errors and fall back to the DB.
  let resumed: ReadableStream<string> | null | undefined;
  try {
    resumed = await streamContext.resumeExistingStream(streamId);
  } catch (err) {
    console.warn(
      '[chat] resume failed, falling back to persisted message —',
      describeError(err)
    );
    return new Response(null, { status: 204 });
  }
  if (!resumed) {
    return new Response(null, { status: 204 });
  }

  // resumed yields SSE strings; encode to bytes for the Response body.
  return new Response(resumed.pipeThrough(new TextEncoderStream()), {
    headers: UI_MESSAGE_STREAM_HEADERS
  });
}

/**
 * Stop the reply being written in a chat. Closing the connection does not do
 * it: a generation deliberately outlives its reader, so that a closed tab
 * still ends with a stored reply and a recorded cost. Stopping is said here.
 */
async function DELETE({
  request: req,
  context
}: {
  request: Request;
  context: { user: User };
}) {
  const chatId = new URL(req.url).searchParams.get('chatId');
  if (!chatId) {
    return Response.json({ error: 'chatId is required' }, { status: 400 });
  }

  // Withdrawn first and scoped to the owner, so the chat id alone stops
  // nothing of anyone else's — and only then the shortcut, for a generation
  // that happens to be running right here.
  const held = await chats.getStreamId(context.user.id, chatId);
  await chats.stopGeneration(context.user.id, chatId);
  if (held) running.get(chatId)?.abort();

  return new Response(null, { status: 204 });
}
