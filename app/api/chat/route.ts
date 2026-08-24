import { NextResponse } from 'next/server';
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
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  ChatErrorKind,
  ChatMessage,
  createArtifactInputSchema,
  MessageMetadata,
  type Artifact
} from '@/types';
import {
  artifactKindFromType,
  assertArtifactPayload,
  type ArtifactKind
} from '@/lib/artifact';
import { maskUnsupportedFileParts } from '@/lib/chat-media-urls';
import { sanitizeTitle, titleInputFromMessage } from '@/lib/chat-title';
import { buildMediaTools, MediaToolsOptions } from '@/lib/chat-tools';
import { normalizeChatUsage } from '@/lib/chat-usage';
import { ArtifactSystemPrompt } from '@/lib/constant';
import { preflightCheck } from '@/lib/preflight';
import {
  AllProvidersFailedError,
  bindingsToFailoverProviders,
  getLanguageModel,
  type FailoverProvider
} from '@/lib/provider';
import {
  findModelByModelId,
  getSystemPrompt,
  getTitleSettings
} from '@/lib/queries';
import { getResumableStreamContext } from '@/lib/resumable-stream';
import { recordChatUsage } from '@/lib/usage';
import { convertToChatMessages, formatString, generateUUID } from '@/lib/utils';
import { getVerifiedSession } from '@/server/auth';
import { db } from '@/server/db';
import {
  artifacts as artifactsTable,
  chats as chatsTable,
  messages as messagesTable
} from '@/server/db/schema';
import { api } from '@/trpc/server';

// Media tools (video generation especially — Sora polls for up to 5 minutes)
// can far outlive a plain chat completion. 300s is the hard ceiling on Vercel's
// Hobby plan, so anything larger is silently capped rather than granted; a slow
// video render can still exhaust the budget and time the whole request out.
export const maxDuration = 300;

type PostData = {
  id: string;
  modelId: string;
  userMessage: Omit<ChatMessage, 'role'> & { role: 'user' };
  parentMessageId?: string;
  isReasoning?: boolean;
  mediaOptions?: MediaToolsOptions;
};

// Verbose error serializer — resumable-stream / node-redis failures often
// surface as empty `Error` objects under Next's ignore-listed stack redaction,
// so dig out name/code/cause/aggregate to make the real reason visible.
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

export async function POST(req: Request) {
  const session = await getVerifiedSession();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json: PostData = await req.json();
  const id = json.id || generateUUID();
  const { modelId, userMessage, parentMessageId, isReasoning, mediaOptions } =
    json;

  if (!modelId || !userMessage) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  // Fetch model from database to validate
  const dbModel = await findModelByModelId(modelId, 'chat');
  const candidates = bindingsToFailoverProviders(dbModel?.providers ?? []);

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
      userId: session.user.id,
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

  let title = 'Untitled';
  // No type filter: continuing a legacy media chat reuses its row.
  const chat = await api.chat.detail({
    id,
    includeMessages: false
  });
  const UNTITLED = 'Untitled';

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

      const { text } = await generateText({
        model: getLanguageModel(titleProvider, titleModelId),
        instructions: titlePrompt,
        prompt: input
      });

      return sanitizeTitle(text) || UNTITLED;
    } catch (err: any) {
      console.error(`Generate title error:`, err.message);
      return UNTITLED;
    }
  };

  if (!chat) {
    title = await generateTitle();

    await api.chat.create({
      id,
      title,
      modelId,
      messages: [userMessage]
    });
  } else {
    title = chat.title;

    // A refusal on the very first message creates the chat still named
    // "Untitled", and titling only ever ran for a chat that did not exist yet
    // — so without this the name would stick for the life of the chat.
    if (title === UNTITLED) {
      const generated = await generateTitle();
      if (generated !== UNTITLED) {
        title = generated;
        await api.chat.update({ id, title });
      }
    }

    if (parentMessageId && parentMessageId === userMessage.id) {
      await api.message.delete({ parentId: parentMessageId });
    } else {
      await api.message.create({
        chatId: id,
        messages: [userMessage]
      });
    }
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
        } as Parameters<typeof writer.write>[0]);
      },
      generateId: () => errorMessageId,
      onEnd: async ({ responseMessage }) => {
        if (!responseMessage) return;
        try {
          // createdAt is left to the database. The user's message was stored
          // with the database's clock, and a refusal lands milliseconds later —
          // close enough that any skew between that clock and this process's
          // puts the refusal *before* the message it answers, and the thread
          // renders in that order on reload. The normal path passes its own
          // timestamp and gets away with it only because a model takes seconds.
          await db.insert(messagesTable).values({
            id: responseMessage.id || errorMessageId,
            parentId: responseMessage.metadata?.parentId ?? userMessage.id,
            role: 'assistant',
            parts: responseMessage.parts,
            chatId: id,
            userId: session.user.id
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

  try {
    const historyMessages = await api.message.list({ chatId: id });
    const chatMessages = convertToChatMessages(historyMessages);

    let reasonStartedAt: Date | null = null;
    let reasonDuration = 0;
    const assistantMessageId = generateUUID();
    // Separate id for the resumable stream (used only when REDIS_URL is set).
    const streamId = generateUUID();

    // Independent setup queries — run concurrently to keep time-to-first-token
    // down (media tool resolution should not delay plain text chats).
    const [systemPromptContent, mediaTools] = await Promise.all([
      getSystemPrompt(dbModel.systemPrompt),
      buildMediaTools({
        userId: session.user.id,
        chatId: id,
        assistantMessageId,
        mediaOptions,
        chatMessages
      })
    ]);
    const systemMessage = systemPromptContent
      ? formatString(systemPromptContent, {
          provider: dbModel.provider?.name || '',
          modelId,
          date: new Date().toISOString()
        })
      : undefined;
    const completedArtifacts = new Map<string, Artifact>();
    const completedArtifactOrder: string[] = [];

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
        const modelMessages = await convertToModelMessages(
          maskUnsupportedFileParts(chatMessages, {
            supportsVision: dbModel.supportsVision
          })
        );

        const buildStream = (failoverProvider: FailoverProvider) =>
          streamText({
            model: getLanguageModel(failoverProvider, modelId),
            instructions: [
              systemMessage,
              ArtifactSystemPrompt,
              mediaTools.systemPrompt
            ]
              .filter(Boolean)
              .join('\n\n'),
            messages: modelMessages,
            tools: { ...artifactTools, ...mediaTools.tools },
            ...(failoverProvider.apiOptions && {
              providerOptions: {
                [failoverProvider.type]: failoverProvider.apiOptions
              } as any
            }),
            temperature: dbModel.apiParams?.temperature,
            topP: dbModel.apiParams?.topP,
            topK: dbModel.apiParams?.topK,
            maxOutputTokens: dbModel.apiParams?.maxOutputTokens,
            frequencyPenalty: dbModel.apiParams?.frequencyPenalty,
            presencePenalty: dbModel.apiParams?.presencePenalty,
            stopWhen: isStepCount(5),
            experimental_transform: smoothStream({ chunking: 'word' }),
            onChunk: ({ chunk }) => {
              if (chunk.type === 'tool-call') {
                console.log('Called Tool: ', chunk.toolName);
              }
              if (chunk.type === 'reasoning-delta') {
                const now = new Date();
                reasonStartedAt ??= now;
                console.log('Reasoning: ', chunk.text);
              }
            },
            onStepEnd: ({ warnings }) => {
              if (warnings) {
                console.log('Warnings: ', warnings);
              }
            },
            onEnd: async ({ usage }) => {
              if (!usage) {
                // Provider didn't report usage — request runs free. Should not
                // happen with major providers; surface so it's visible in logs.
                console.warn(
                  `[chat] no usage reported for model=${modelId}; skipping recordChatUsage`
                );
                return;
              }
              await recordChatUsage({
                userId: session.user.id,
                chatId: id,
                messageId: assistantMessageId,
                modelId,
                providerId: failoverProvider.id,
                usage: normalizeChatUsage(usage)
              });
            }
          });

        // Streaming failover is limited by design: once tokens reach the client
        // a provider can't be swapped without duplicating output, and the AI SDK
        // exposes no "connection established" signal before the stream is
        // consumed (awaiting `res.response` would consume the whole stream and
        // block until generation finishes, breaking streaming). So here we only
        // fail over on errors thrown while *building* the stream (e.g. an invalid
        // provider credential). Runtime/mid-stream errors surface to the client
        // via the UI message stream. Non-streaming routes do full failover.
        let res: ReturnType<typeof buildStream> | undefined;
        const failoverAttempts: { provider: string; error: unknown }[] = [];
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          const isLast = i === candidates.length - 1;
          try {
            res = buildStream(candidate);
            break;
          } catch (error) {
            // Any build-time error (bad/undecryptable credential, invalid
            // provider config) means this provider can't start — try the next
            // one regardless; rethrow only after the last candidate.
            failoverAttempts.push({ provider: candidate.name, error });
            if (isLast) {
              throw error;
            }
          }
        }
        if (!res) {
          throw new AllProvidersFailedError(
            'All providers failed',
            failoverAttempts
          );
        }

        res.consumeStream();

        writer.merge(
          res.toUIMessageStream({
            originalMessages: chatMessages,
            generateMessageId: () => assistantMessageId,
            sendReasoning: isReasoning,
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
      },
      generateId: generateUUID,
      onEnd: async ({ responseMessage }) => {
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

        const persistedArtifacts = completedArtifactOrder
          .map(artifactId => completedArtifacts.get(artifactId))
          .filter((artifact): artifact is Artifact => Boolean(artifact));

        await db.transaction(async tx => {
          await tx.insert(messagesTable).values({
            id: responseMessage.id,
            parentId: responseMessage.metadata?.parentId ?? userMessage.id,
            role: responseMessage.role,
            parts: responseMessage.parts,
            chatId: id,
            userId: session.user.id,
            reasonDuration: responseMessage.metadata?.reasonDuration,
            createdAt: responseMessage.metadata?.createdAt ?? finishedAt,
            updatedAt: responseMessage.metadata?.updatedAt ?? finishedAt
          });

          // Each artifact created this turn is its own independent row, pinned
          // to this turn's message.
          if (persistedArtifacts.length > 0) {
            await tx.insert(artifactsTable).values(
              persistedArtifacts.map(artifact => ({
                id: artifact.id,
                chatId: id,
                messageId: responseMessage.id,
                userId: session.user.id,
                title: artifact.title,
                type: artifact.type,
                language: artifact.language ?? null,
                content: artifact.content ?? null,
                fileUrl: artifact.fileUrl ?? null,
                fileName: artifact.fileName ?? null,
                mimeType: artifact.mimeType ?? null,
                size: artifact.size ?? null,
                createdAt: artifact.createdAt,
                updatedAt: artifact.updatedAt
              }))
            );
          }
        });

        // Update chat model if changed
        if (chat && chat.modelId !== modelId) {
          try {
            await api.chat.update({
              id,
              modelId
            });
          } catch (err) {
            console.warn('Unable to update chat', id, err);
          }
        }
      },
      onError: error => {
        if (error == null) {
          return 'Unknown error';
        }

        if (typeof error === 'string') {
          return error;
        }

        if (error instanceof Error) {
          return error.message;
        }

        return JSON.stringify(error);
      }
    });

    // When Redis is configured, wrap the stream as a resumable one so a page
    // refresh can re-attach to an in-progress generation (see the GET handler).
    // resumableStream drains the source into Redis, which — like consumeStream
    // below — keeps tool work, usage and persistence running past a client
    // disconnect.
    const streamContext = await getResumableStreamContext();
    if (streamContext) {
      try {
        // Record this generation's stream id on the chat so the GET handler
        // can resume it after a refresh (overwrites any prior, finished one).
        await db
          .update(chatsTable)
          .set({ activeStreamId: streamId })
          .where(eq(chatsTable.id, id));
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
    return NextResponse.json(
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
export async function GET(req: Request) {
  const streamContext = await getResumableStreamContext();
  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  const session = await getVerifiedSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const chatId = new URL(req.url).searchParams.get('chatId');
  if (!chatId) {
    return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
  }

  // Only the chat owner may resume, and only if it has an active stream.
  const chat = await db.query.chats.findFirst({
    where: (c, { and, eq }) =>
      and(eq(c.id, chatId), eq(c.userId, session.user.id))
  });
  if (!chat?.activeStreamId) {
    return new Response(null, { status: 204 });
  }

  // resumeExistingStream returns null/undefined once the stream has finished or
  // expired, in which case the final message is already persisted and the
  // client uses that. A Redis blip must not turn a reconnect into a 500 — since
  // resume fires on every chat mount, swallow errors and fall back to the DB.
  let resumed: ReadableStream<string> | null | undefined;
  try {
    resumed = await streamContext.resumeExistingStream(chat.activeStreamId);
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
