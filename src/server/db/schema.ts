import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/pg-core';
import type { PgColumn } from 'drizzle-orm/pg-core';

import type { JSONValue } from 'ai';
import type { ChatMessage, ChatType, ProviderType } from '@/types';

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator(name => name);

export const chats = createTable(
  'chat',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    type: varchar('type', { length: 32 })
      .notNull()
      .default('chat')
      .$type<ChatType>(),
    modelId: varchar('model_id', { length: 255 }).notNull(),
    // Resumable-stream id of an in-progress generation (a Redis key, not a FK).
    // Null when nothing is streaming. The chat route's GET handler reads this
    // to re-attach to the stream after a page refresh. Only set when REDIS_URL
    // is configured.
    activeStreamId: varchar('active_stream_id', { length: 255 }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  chat => [
    index('chat_userId_idx').on(chat.userId),
    index('chat_type_idx').on(chat.type),
    index('chat_createdAt_idx').on(chat.createdAt),
    index('chat_userId_createdAt_idx').on(chat.userId, chat.createdAt),
    index('chat_userId_type_createdAt_idx').on(
      chat.userId,
      chat.type,
      chat.createdAt
    )
  ]
);

export const messages = createTable(
  'message',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    parentId: varchar('parent_id', { length: 255 }).references(
      (): PgColumn => messages.id,
      { onDelete: 'cascade' }
    ),
    role: varchar('role', { length: 32 })
      .notNull()
      .$type<'system' | 'user' | 'assistant'>(),
    parts: jsonb('parts').notNull().$type<ChatMessage['parts']>(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: varchar('chat_id', { length: 255 })
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    reasonDuration: integer('reason_duration'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  message => [
    index('message_parentId_idx').on(message.parentId),
    index('message_userId_idx').on(message.userId),
    index('message_chatId_idx').on(message.chatId),
    index('message_createdAt_idx').on(message.createdAt)
  ]
);

export const messagesRelations = relations(messages, ({ one }) => ({
  user: one(users, { fields: [messages.userId], references: [users.id] }),
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  parent: one(messages, {
    fields: [messages.parentId],
    references: [messages.id]
  })
}));

export const artifacts = createTable(
  'artifact',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    chatId: varchar('chat_id', { length: 255 })
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: varchar('message_id', { length: 255 })
      .notNull()
      .references((): PgColumn => messages.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    type: varchar('type', { length: 32 })
      .notNull()
      .$type<
        'code' | 'markdown' | 'html' | 'json' | 'text' | 'image' | 'file'
      >(),
    language: varchar('language', { length: 64 }),
    content: text('content'),
    fileUrl: text('file_url'),
    fileName: varchar('file_name', { length: 255 }),
    mimeType: varchar('mime_type', { length: 255 }),
    size: integer('size'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  artifact => [
    index('artifact_chatId_idx').on(artifact.chatId),
    index('artifact_messageId_idx').on(artifact.messageId),
    index('artifact_userId_idx').on(artifact.userId),
    index('artifact_createdAt_idx').on(artifact.createdAt),
    index('artifact_chatId_createdAt_idx').on(
      artifact.chatId,
      artifact.createdAt
    )
  ]
);

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  chat: one(chats, { fields: [artifacts.chatId], references: [chats.id] }),
  message: one(messages, {
    fields: [artifacts.messageId],
    references: [messages.id]
  }),
  user: one(users, { fields: [artifacts.userId], references: [users.id] })
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, { fields: [chats.userId], references: [users.id] }),
  model: one(models, { fields: [chats.modelId], references: [models.modelId] }),
  messages: many(messages),
  artifacts: many(artifacts)
}));

export const shares = createTable(
  'share',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    chatId: varchar('chat_id', { length: 255 })
      .notNull()
      .unique()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  share => [
    index('share_chatId_idx').on(share.chatId),
    index('share_userId_idx').on(share.userId)
  ]
);

export const sharesRelations = relations(shares, ({ one }) => ({
  user: one(users, { fields: [shares.userId], references: [users.id] }),
  chat: one(chats, { fields: [shares.chatId], references: [chats.id] })
}));

export const users = createTable(
  'user',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: varchar('role', { length: 50 }).notNull().default('user'),
    planId: varchar('plan_id', { length: 255 }).references(
      (): PgColumn => plans.id,
      {
        onDelete: 'set null'
      }
    ),
    quotaId: varchar('quota_id', { length: 255 }).references(
      (): PgColumn => quotas.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  user => [
    index('user_plan_id_idx').on(user.planId),
    index('user_quota_id_idx').on(user.quotaId)
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  accounts: many(accounts),
  plan: one(plans, { fields: [users.planId], references: [plans.id] }),
  quota: one(quotas, { fields: [users.quotaId], references: [quotas.id] })
}));

export const accounts = createTable(
  'account',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    // The identity namespace an account belongs to. OAuth providers without an
    // issuer of their own get `local:oauth:<providerId>`; credential logins get
    // `local:credential`. Paired with `accountId` it is what makes two
    // providers unable to claim the same identity.
    issuer: varchar('issuer', { length: 255 }).notNull(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  account => [
    index('account_user_id_idx').on(account.userId),
    uniqueIndex('account_issuer_account_id_idx').on(
      account.issuer,
      account.accountId
    )
  ]
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] })
}));

export const sessions = createTable(
  'session',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true
    }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  session => [index('session_user_id_idx').on(session.userId)]
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] })
}));

/**
 * One table for every short-lived credential. Replaces `verification_token`
 * and `email_verification_code`: the emailOTP plugin owns code length, expiry
 * and the attempt limit, so none of that is hand-rolled any more.
 */
export const verifications = createTable(
  'verification',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  v => [index('verification_identifier_idx').on(v.identifier)]
);

export const providers = createTable(
  'provider',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 50 }).$type<ProviderType>().notNull(),
    apiKey: text('api_key').notNull(),
    baseUrl: varchar('base_url', { length: 500 }),
    isEnabled: boolean('is_enabled').notNull().default(false),
    // A JSONB column holds JSON, and saying so lets a value read out of it be
    // proven serializable on its way to the browser.
    apiOptions: jsonb('api_options').$type<Record<string, JSONValue>>(),
    image: text('image'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  provider => [
    index('provider_type_idx').on(provider.type),
    index('provider_is_enabled_idx').on(provider.isEnabled)
  ]
);

export const providersRelations = relations(providers, ({ many }) => ({
  models: many(models),
  modelProviders: many(modelProviders)
}));

/**
 * Prompt - System prompts and user templates
 * Types: system (for system workflows), user (for user-facing templates)
 * OwnerKind: admin (admin-created prompt), user (user-created prompt)
 * Capability: chat, image, video, audio
 * Providers: array of provider types (e.g., openai, xai, google)
 */
export const prompts = createTable(
  'prompt',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    // Creator of the prompt. Admins are regular users with extra rights, so
    // ownership is just the creator — there is no separate admin/user owner kind.
    userId: varchar('user_id', { length: 255 }).references(() => users.id, {
      onDelete: 'cascade'
    }),
    // private = only the creator; public = visible to everyone.
    visibility: varchar('visibility', { length: 20 })
      .notNull()
      .default('private')
      .$type<'private' | 'public'>(),
    // Free-text labels for browsing/filtering.
    tags: jsonb('tags').$type<Array<string>>(),
    // Free-text display labels only (NOT linked to the providers table, not filtered).
    providers: jsonb('providers').$type<Array<string>>(),
    // Model ids (from the models table) this prompt targets — used for filtering.
    models: jsonb('models').$type<Array<string>>(),
    image: text('image'),
    content: text('content').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  prompt => [
    index('prompt_user_id_idx').on(prompt.userId),
    index('prompt_visibility_idx').on(prompt.visibility)
  ]
);

export const promptsRelations = relations(prompts, ({ one }) => ({
  user: one(users, {
    fields: [prompts.userId],
    references: [users.id]
  })
}));

/**
 * Model - AI model configurations
 * Capabilities: chat, image, video, audio
 */
export const models = createTable(
  'model',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    modelId: varchar('model_id', { length: 255 }).notNull().unique(),
    providerId: varchar('provider_id', { length: 255 })
      .notNull()
      .references(() => providers.id, { onDelete: 'restrict' }),
    capability: varchar('capability', { length: 32 })
      .notNull()
      .$type<'chat' | 'image' | 'video' | 'audio'>(),
    image: text('image'),
    aliases: jsonb('aliases').$type<Array<string>>(),
    supportsVision: boolean('supports_vision').default(false),
    supportsReasoning: boolean('supports_reasoning').default(false),
    // Image models: can edit an existing image.
    supportsImageEdit: boolean('supports_image_edit').default(false),
    // Video models: can take an image as the opening frame.
    supportsImageToVideo: boolean('supports_image_to_video').default(false),
    // Video models: can edit an existing video, which is a separate capability
    // from taking an image as the opening frame.
    supportsVideoEdit: boolean('supports_video_edit').default(false),
    // Audio models: this is an STT (speech→text) model; unset means TTS.
    supportsTranscription: boolean('supports_transcription').default(false),
    isEnabled: boolean('is_enabled').notNull().default(true),
    uiOptions: jsonb('ui_options').$type<{
      size?: string;
      sizes?: Array<string>;
      aspectRatio?: string;
      aspectRatios?: Array<string>;
      duration?: number;
      durations?: Array<number>;
      resolution?: string;
      resolutions?: Array<string>;
      voice?: string;
      voices?: Array<string>;
      reasoning?: boolean;
    }>(),
    apiParams: jsonb('api_params').$type<{
      temperature?: number;
      topP?: number;
      topK?: number;
      maxOutputTokens?: number;
      frequencyPenalty?: number;
      presencePenalty?: number;
    }>(),
    systemPrompt: text('system_prompt'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  model => [
    index('model_provider_id_idx').on(model.providerId),
    index('model_capability_idx').on(model.capability),
    index('model_is_enabled_idx').on(model.isEnabled)
  ]
);

export const modelsRelations = relations(models, ({ one, many }) => ({
  // Deprecated single-provider link, kept for backward compatibility while the
  // app migrates to the many-to-many `modelProviders` table. New code should
  // resolve providers through `modelProviders` (ordered by priority).
  provider: one(providers, {
    fields: [models.providerId],
    references: [providers.id]
  }),
  pricings: many(modelPricings),
  modelProviders: many(modelProviders)
}));

/**
 * Model ↔ Provider binding (many-to-many).
 *
 * A logical model (`models`, keyed by the still-unique `modelId`) can be served
 * by multiple providers that all support the same `modelId` (e.g. OpenAI +
 * Azure + an OpenAI-compatible gateway). At call time the app walks these
 * bindings ordered by `priority` (ascending) and fails over to the next enabled
 * binding on a retryable error — always calling the same `modelId`.
 */
export const modelProviders = createTable(
  'model_provider',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    modelId: varchar('model_id', { length: 255 })
      .notNull()
      .references(() => models.modelId, { onDelete: 'cascade' }),
    providerId: varchar('provider_id', { length: 255 })
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(0),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  modelProvider => [
    uniqueIndex('model_provider_model_provider_idx').on(
      modelProvider.modelId,
      modelProvider.providerId
    ),
    index('model_provider_priority_idx').on(
      modelProvider.modelId,
      modelProvider.priority
    )
  ]
);

export const modelProvidersRelations = relations(modelProviders, ({ one }) => ({
  model: one(models, {
    fields: [modelProviders.modelId],
    references: [models.modelId]
  }),
  provider: one(providers, {
    fields: [modelProviders.providerId],
    references: [providers.id]
  })
}));

/**
 * Setting - Application settings (key-value store)
 */
export const settings = createTable('setting', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: text('value'),
  description: varchar('description', { length: 500 }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

// ============================================================================
// Billing / Usage / Quota Tables
// ============================================================================

/**
 * Quota - A reusable, named bundle of usage limits.
 *
 * Quotas are independent entities. They are consumed by:
 *   - Plans (each plan references one quota via plan.quotaId)
 *   - The system default (configured in `setting` under key `default.quotaId`,
 *     used for users with plan_id IS NULL — i.e. free users)
 *
 * allowedModelIds is a whitelist of `model.modelId` values (e.g. "gpt-4o"),
 * not `model.id` (UUID). An empty array means "no restriction" (all enabled
 * models allowed).
 */
export const quotas = createTable('quota', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: varchar('description', { length: 500 }),
  fiveHour: numeric('five_hour', { precision: 20, scale: 10 }),
  sevenDay: numeric('seven_day', { precision: 20, scale: 10 }),
  isUnlimited: boolean('is_unlimited').notNull().default(false),
  allowedModelIds: jsonb('allowed_model_ids')
    .$type<Array<string>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const quotasRelations = relations(quotas, ({ many }) => ({
  plans: many(plans),
  users: many(users)
}));

/**
 * Plan - Subscription tier (Pro, Team, ...). Each plan references a quota
 * via quotaId. Users without a planId are "Free" and use the system default
 * quota (configured under setting key `default.quotaId`).
 */
export const plans = createTable('plan', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: varchar('description', { length: 500 }),
  quotaId: varchar('quota_id', { length: 255 })
    .notNull()
    .references(() => quotas.id, { onDelete: 'restrict' }),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const plansRelations = relations(plans, ({ one, many }) => ({
  quota: one(quotas, {
    fields: [plans.quotaId],
    references: [quotas.id]
  }),
  users: many(users)
}));

/**
 * Model Pricing - Per-model price entries.
 *
 * Pricing columns are USD by convention. Units:
 *   - input / output / cacheRead / cacheWrite / audioInput / audioOutput
 *     / audioCharacters → per 1M (tokens, or characters for audioCharacters)
 *   - image / video → per item
 *   - videoSeconds → per second
 *
 * One row per model (model_id is UNIQUE, referencing models.modelId).
 * Historical price changes don't need to be preserved here because
 * `usage.cost` is denormalized at write-time.
 */
export const modelPricings = createTable(
  'model_pricing',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    modelId: varchar('model_id', { length: 255 })
      .notNull()
      .unique()
      .references(() => models.modelId, { onDelete: 'cascade' }),
    input: numeric('input', { precision: 20, scale: 10 }),
    output: numeric('output', { precision: 20, scale: 10 }),
    cacheRead: numeric('cache_read', { precision: 20, scale: 10 }),
    cacheWrite: numeric('cache_write', { precision: 20, scale: 10 }),
    // Reasoning rate. Most providers (OpenAI o1, Anthropic, Google, DeepSeek)
    // bill reasoning at the output rate — leave null and the cost engine
    // falls back to `output`. Some models (Qwen thinking variants) have a
    // distinct reasoning rate — set this column to override.
    reasoning: numeric('reasoning', { precision: 20, scale: 10 }),
    image: numeric('image', { precision: 20, scale: 10 }),
    video: numeric('video', { precision: 20, scale: 10 }),
    videoSeconds: numeric('video_seconds', { precision: 20, scale: 10 }),
    // Audio bills EITHER per character (classic TTS: tts-1, Google, Azure,
    // Polly, ElevenLabs) OR per token (token-based: gpt-4o-mini-tts, gpt-audio,
    // omni). Mutually exclusive — see calculateAudioCost / pricing router.
    audioInput: numeric('audio_input', { precision: 20, scale: 10 }),
    audioOutput: numeric('audio_output', { precision: 20, scale: 10 }),
    audioCharacters: numeric('audio_characters', { precision: 20, scale: 10 }),
    // Transcription (STT) bills per second of input audio — the only
    // dimension `transcribe()` reliably reports (durationInSeconds).
    audioSeconds: numeric('audio_seconds', { precision: 20, scale: 10 }),
    source: varchar('source', { length: 50 })
      .notNull()
      .default('manual')
      .$type<'manual' | 'models.dev' | 'llm-metadata'>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  }
  // No explicit index on model_id — the .unique() constraint above already
  // creates one.
);

export const modelPricingsRelations = relations(modelPricings, ({ one }) => ({
  model: one(models, {
    fields: [modelPricings.modelId],
    references: [models.modelId]
  })
}));

/**
 * Usage Record - One row per generation call.
 *
 * Each row stores both the usage quantities AND a snapshot of the prices that
 * were used to compute `cost`. This makes historical billing self-contained:
 * model_pricing can change later without rewriting history, and no FK to a
 * pricing row is needed.
 *
 * Quantity columns mirror the dimensions in `model_pricing`:
 *   - input_tokens / output_tokens / cache_read_tokens / cache_write_tokens
 *     / reasoning_tokens → chat (per 1M tokens). `reasoning_tokens` is billed
 *     at the `output_price` rate (no separate price).
 *   - image_count → image generations (per item).
 *   - video_count / video_seconds → video generations (per item or per second).
 *   - audio_input_tokens / audio_output_tokens → token-based audio models
 *     (per 1M tokens); audio_characters → classic TTS (per character).
 *     Mutually exclusive per model.
 *
 * Price columns are USD per unit, matching `model_pricing` semantics.
 */
export const usage = createTable(
  'usage',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    userId: varchar('user_id', { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: varchar('chat_id', { length: 255 }).references(() => chats.id, {
      onDelete: 'set null'
    }),
    messageId: varchar('message_id', { length: 255 }),
    modelId: varchar('model_id', { length: 255 }),
    providerId: varchar('provider_id', { length: 255 }),
    capability: varchar('capability', { length: 32 })
      .notNull()
      .$type<'chat' | 'image' | 'video' | 'audio'>(),

    // Quantities — one per pricing dimension
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    imageCount: integer('image_count').notNull().default(0),
    videoCount: integer('video_count').notNull().default(0),
    videoSeconds: numeric('video_seconds', { precision: 12, scale: 3 })
      .notNull()
      .default('0'),
    audioInputTokens: integer('audio_input_tokens').notNull().default(0),
    audioOutputTokens: integer('audio_output_tokens').notNull().default(0),
    audioCharacters: integer('audio_characters').notNull().default(0),
    audioSeconds: numeric('audio_seconds', { precision: 12, scale: 3 })
      .notNull()
      .default('0'),

    // Price snapshot at compute time (USD per unit; semantics match model_pricing)
    inputPrice: numeric('input_price', { precision: 20, scale: 10 }),
    outputPrice: numeric('output_price', { precision: 20, scale: 10 }),
    cacheReadPrice: numeric('cache_read_price', { precision: 20, scale: 10 }),
    cacheWritePrice: numeric('cache_write_price', { precision: 20, scale: 10 }),
    reasoningPrice: numeric('reasoning_price', { precision: 20, scale: 10 }),
    imagePrice: numeric('image_price', { precision: 20, scale: 10 }),
    videoPrice: numeric('video_price', { precision: 20, scale: 10 }),
    videoSecondsPrice: numeric('video_seconds_price', {
      precision: 20,
      scale: 10
    }),
    audioInputPrice: numeric('audio_input_price', { precision: 20, scale: 10 }),
    audioOutputPrice: numeric('audio_output_price', {
      precision: 20,
      scale: 10
    }),
    audioCharactersPrice: numeric('audio_characters_price', {
      precision: 20,
      scale: 10
    }),
    audioSecondsPrice: numeric('audio_seconds_price', {
      precision: 20,
      scale: 10
    }),

    cost: numeric('cost', { precision: 20, scale: 10 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  record => [
    index('usage_chat_id_idx').on(record.chatId),
    index('usage_model_id_idx').on(record.modelId),
    index('usage_created_at_idx').on(record.createdAt),
    index('usage_user_created_idx').on(record.userId, record.createdAt)
  ]
);

export const usageRelations = relations(usage, ({ one }) => ({
  user: one(users, { fields: [usage.userId], references: [users.id] }),
  chat: one(chats, { fields: [usage.chatId], references: [chats.id] })
}));
