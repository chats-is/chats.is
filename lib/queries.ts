import 'server-only';

import { cache } from 'react';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import type { ResolvedSource } from '@/types';
import { parseNumber } from '@/lib/utils';
import { db } from '@/server/db';
import {
  modelProviders,
  models,
  providers,
  quotas,
  settings,
  usage,
  users
} from '@/server/db/schema';

// ============================================================================
// Types
// ============================================================================

type Provider = typeof providers.$inferSelect;
type ProviderBinding = typeof modelProviders.$inferSelect & {
  provider: Provider | null;
};
type Model = typeof models.$inferSelect & {
  /** @deprecated highest-priority provider, kept for legacy callers. */
  provider: Provider | null;
  /** Priority-ordered, enabled provider bindings for failover. */
  providers: ProviderBinding[];
};
type QuotaRow = typeof quotas.$inferSelect;

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================================
// Internal Query Helpers
// ============================================================================

const getAllModels = cache(async (): Promise<Model[]> => {
  const result = await db.query.models.findMany({
    where: eq(models.isEnabled, true),
    with: {
      provider: true,
      modelProviders: {
        with: { provider: true }
      }
    },
    orderBy: (models, { asc }) => [asc(models.displayOrder)]
  });

  return result
    .map(m => {
      const hasBindings = (m.modelProviders ?? []).length > 0;
      // New path: enabled bindings ordered by priority (provider also enabled).
      const bindings = (m.modelProviders ?? [])
        .filter(b => b.isEnabled && b.provider?.isEnabled)
        .sort((a, b) => a.priority - b.priority);

      // Backward-compat fallback ONLY when the model has no binding rows yet
      // (pre-migration). A model that HAS bindings but all are disabled stays
      // unavailable — we must not resurrect a provider the admin disabled.
      const providersList: ProviderBinding[] = hasBindings
        ? bindings
        : m.provider?.isEnabled
          ? [
              {
                id: `legacy:${m.id}`,
                modelId: m.modelId,
                providerId: m.providerId,
                priority: 0,
                isEnabled: true,
                createdAt: m.createdAt,
                updatedAt: m.updatedAt,
                provider: m.provider
              }
            ]
          : [];

      return {
        ...m,
        provider: providersList[0]?.provider ?? m.provider ?? null,
        providers: providersList
      };
    })
    .filter(m => m.providers.length > 0);
});

// ============================================================================
// Model Queries
// ============================================================================

export const findModelByModelId = cache(
  async (
    modelId: string,
    capability?: 'chat' | 'image' | 'video' | 'audio'
  ): Promise<Model | undefined> => {
    const allModels = await getAllModels();

    return allModels.find(m => {
      if (capability && m.capability !== capability) return false;
      const aliases = m.aliases as string[] | null;
      return m.modelId === modelId || aliases?.includes(modelId);
    });
  }
);

// ============================================================================
// Settings Queries
// ============================================================================

/** System default quota id (setting `default.quotaId`). Applied to users
 *  with no plan and no override. `null` = unconfigured (free unlimited). */
export const getDefaultQuotaId = cache(async (): Promise<string | null> => {
  const values = await getSettings(['default.quotaId']);
  return values['default.quotaId'];
});

export const getSpeechSettings = cache(async () => {
  const values = await getSettings([
    'speech.enabled',
    'default.speech.modelId',
    'default.speech.voice'
  ]);

  return {
    speechEnabled: values['speech.enabled'] === 'true',
    defaultModel: values['default.speech.modelId'],
    defaultVoice: values['default.speech.voice'] || undefined
  };
});

/** Admin-configured default media models for the chat media tools. */
export const getMediaDefaultModelIds = cache(async () => {
  const values = await getSettings([
    'default.image.modelId',
    'default.video.modelId',
    'default.tts.modelId',
    'default.stt.modelId'
  ]);

  return {
    imageModelId: values['default.image.modelId'],
    videoModelId: values['default.video.modelId'],
    ttsModelId: values['default.tts.modelId'],
    sttModelId: values['default.stt.modelId']
  };
});

const DEFAULT_TITLE_PROMPT = `
- Generate a short title that summarizes the user's first message.
- Respond in the same language as the user's message.
- Keep it under 50 characters — just a few words.
- Do not use quotes or colons.
- Output only the title text, with nothing else (no preamble, punctuation, or explanation).
`.trim();

export const getTitleSettings = cache(async () => {
  const values = await getSettings(['title.modelId']);
  const modelId = values['title.modelId'];

  const model = modelId ? await findModelByModelId(modelId) : undefined;

  // Title generation uses a fixed internal prompt (no longer admin-configurable).
  return {
    prompt: DEFAULT_TITLE_PROMPT,
    modelId,
    provider: model?.provider ?? null
  };
});

// ============================================================================
//  System Prompt
// ============================================================================

export const getSystemPrompt = cache(
  async (modelSystemPrompt?: string | null): Promise<string | null> => {
    // The model carries its own inline system prompt; fall back to the global
    // default chat system prompt setting when the model leaves it empty.
    if (modelSystemPrompt && modelSystemPrompt.trim()) {
      return modelSystemPrompt;
    }
    const values = await getSettings(['default.chat.systemPrompt']);
    return values['default.chat.systemPrompt'] || null;
  }
);

const getSettings = cache(
  async (keys: string[]): Promise<Record<string, string | null>> => {
    if (keys.length === 0) {
      return {};
    }

    try {
      const results = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, keys));

      const resultMap = new Map(results.map(r => [r.key, r.value]));
      return keys.reduce(
        (acc, key) => {
          acc[key] = resultMap.get(key) ?? null;
          return acc;
        },
        {} as Record<string, string | null>
      );
    } catch {
      console.warn(
        'Failed to fetch settings, using defaults. DB might be unavailable during build.'
      );
      return keys.reduce(
        (acc, key) => {
          acc[key] = null;
          return acc;
        },
        {} as Record<string, string | null>
      );
    }
  }
);

// ============================================================================
// App Defaults
// ============================================================================

const DEFAULT_APP_NAME = 'Chats.is';
const DEFAULT_APP_SUBTITLE = 'AI Chatbot';
const DEFAULT_APP_DESCRIPTION =
  'Chats.is empowers you to inquire, receive immediate responses, and engage in dynamic conversations with AI. Offering access to GPT, Claude, Gemini, and an array of other models, Chats.is provides a seamless and interactive experience for all your conversational needs.';

// ============================================================================
// High-level Service Functions
// ============================================================================

export const getAppSettings = cache(async () => {
  const values = await getSettings([
    'app.name',
    'app.subtitle',
    'app.description'
  ]);

  return {
    appName: values['app.name'] || DEFAULT_APP_NAME,
    appSubtitle: values['app.subtitle'] || DEFAULT_APP_SUBTITLE,
    appDescription: values['app.description'] || DEFAULT_APP_DESCRIPTION
  };
});

export async function getSystemSettings() {
  const [allModels, values] = await Promise.all([
    getAllModels(),
    getSettings([
      'app.name',
      'app.subtitle',
      'app.description',
      'speech.enabled',
      'default.chat.modelId',
      'default.image.modelId',
      'default.video.modelId',
      'default.tts.modelId',
      'default.stt.modelId',
      'default.speech.modelId',
      'default.speech.voice'
    ])
  ]);

  return {
    appName: values['app.name'] || DEFAULT_APP_NAME,
    appSubtitle: values['app.subtitle'] || DEFAULT_APP_SUBTITLE,
    appDescription: values['app.description'] || DEFAULT_APP_DESCRIPTION,
    speechEnabled: values['speech.enabled'] === 'true',
    chatModels: allModels.filter(m => m.capability === 'chat'),
    imageModels: allModels.filter(m => m.capability === 'image'),
    videoModels: allModels.filter(m => m.capability === 'video'),
    ttsModels: allModels.filter(
      m => m.capability === 'audio' && !m.supportsTranscription
    ),
    sttModels: allModels.filter(
      m => m.capability === 'audio' && m.supportsTranscription
    ),
    defaults: {
      chatModelId: values['default.chat.modelId'],
      imageModelId: values['default.image.modelId'],
      videoModelId: values['default.video.modelId'],
      ttsModelId: values['default.tts.modelId'],
      sttModelId: values['default.stt.modelId'],
      speechModelId: values['default.speech.modelId'],
      speechVoice: values['default.speech.voice']
    }
  };
}

// ============================================================================
// Quota Queries
// ============================================================================

/**
 * Resolve which quota row applies to a user, walking
 * override → plan → default → none. cache()-wrapped — preflight calls
 * `assertModelAccess` and `assertQuota` back-to-back; cache dedupes the
 * user/plan join to one DB round-trip.
 */
export const getUserResolvedQuota = cache(
  async (
    userId: string
  ): Promise<{
    quota: QuotaRow | null;
    plan: { id: string; name: string } | null;
    source: ResolvedSource;
  }> => {
    const userRow = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        quota: true,
        plan: { with: { quota: true } }
      }
    });

    const planInfo = userRow?.plan
      ? { id: userRow.plan.id, name: userRow.plan.name }
      : null;

    if (userRow?.quota) {
      return { quota: userRow.quota, plan: planInfo, source: 'override' };
    }

    if (userRow?.plan?.quota) {
      return { quota: userRow.plan.quota, plan: planInfo, source: 'plan' };
    }

    const defaultId = await getDefaultQuotaId();
    if (defaultId) {
      const defaultQuota = await db.query.quotas.findFirst({
        where: eq(quotas.id, defaultId)
      });
      if (defaultQuota) {
        return { quota: defaultQuota, plan: planInfo, source: 'default' };
      }
    }
    return { quota: null, plan: planInfo, source: 'none' };
  }
);

/**
 * Aggregate cost + reset time for a user's rolling 5h and 7d windows in a
 * single SQL. The reset time = earliest record in the window + window size
 * (when that record ages out, the rolling sum starts dropping).
 */
export async function getUserUsageWindows(userId: string): Promise<{
  fiveHour: { used: number; resetAt: Date | null };
  sevenDay: { used: number; resetAt: Date | null };
}> {
  const now = Date.now();
  const fiveHourSince = new Date(now - FIVE_HOUR_MS);
  const sevenDaySince = new Date(now - SEVEN_DAY_MS);

  const result = await db
    .select({
      sumFiveHour: sql<string>`coalesce(sum(${usage.cost}) filter (where ${usage.createdAt} >= ${fiveHourSince}), 0)`,
      sumSevenDay: sql<string>`coalesce(sum(${usage.cost}), 0)`,
      minFiveHour: sql<Date | null>`min(${usage.createdAt}) filter (where ${usage.createdAt} >= ${fiveHourSince})`,
      minSevenDay: sql<Date | null>`min(${usage.createdAt})`
    })
    .from(usage)
    .where(and(eq(usage.userId, userId), gte(usage.createdAt, sevenDaySince)));

  const r = result[0];
  return {
    fiveHour: {
      used: parseNumber(r?.sumFiveHour) ?? 0,
      resetAt: r?.minFiveHour
        ? new Date(new Date(r.minFiveHour).getTime() + FIVE_HOUR_MS)
        : null
    },
    sevenDay: {
      used: parseNumber(r?.sumSevenDay) ?? 0,
      resetAt: r?.minSevenDay
        ? new Date(new Date(r.minSevenDay).getTime() + SEVEN_DAY_MS)
        : null
    }
  };
}
