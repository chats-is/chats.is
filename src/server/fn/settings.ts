import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { generateUUID } from '@/lib/utils';
import { db } from '@/server/db';
import { settings } from '@/server/db/schema';
import { adminMiddleware } from '@/server/middleware';

export const listSettings = createServerFn({ method: 'GET' })
  .middleware([adminMiddleware])
  .handler(async () => {
    return await db.query.settings.findMany();
  });

export const getSetting = createServerFn({ method: 'GET' })
  .validator(z.object({ key: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await db.query.settings.findFirst({
      where: eq(settings.key, data.key)
    });
  });

export const getSettingDefaults = createServerFn({ method: 'GET' }).handler(
  async () => {
    const allSettings = await db.query.settings.findMany();
    const result: Record<string, string | null> = {};
    for (const setting of allSettings) {
      result[setting.key] = setting.value;
    }
    return result;
  }
);

/**
 * Get complete system settings for client initialization
 * Includes all enabled models and default settings
 */
export const getSystemSettingsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getSystemSettings } = await import('@/lib/queries');
    return getSystemSettings();
  }
);

export const updateSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      key: z.string().min(1).max(100),
      value: z.string().nullable(),
      description: z.string().max(500).optional()
    })
  )
  .handler(async ({ data }) => {
    const existing = await db.query.settings.findFirst({
      where: eq(settings.key, data.key)
    });

    if (existing) {
      await db
        .update(settings)
        .set({
          value: data.value,
          description: data.description ?? existing.description,
          updatedAt: new Date()
        })
        .where(eq(settings.key, data.key));
    } else {
      await db.insert(settings).values({
        id: generateUUID(),
        key: data.key,
        value: data.value,
        description: data.description
      });
    }
  });

export const bulkUpdateSettings = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(
    z.array(
      z.object({
        key: z.string().min(1).max(100),
        value: z.string().nullable(),
        description: z.string().max(500).optional()
      })
    )
  )
  .handler(async ({ data }) => {
    for (const item of data) {
      const existing = await db.query.settings.findFirst({
        where: eq(settings.key, item.key)
      });

      if (existing) {
        await db
          .update(settings)
          .set({
            value: item.value,
            description: item.description ?? existing.description,
            updatedAt: new Date()
          })
          .where(eq(settings.key, item.key));
      } else {
        await db.insert(settings).values({
          id: generateUUID(),
          key: item.key,
          value: item.value,
          description: item.description
        });
      }
    }
  });

export const deleteSetting = createServerFn({ method: 'POST' })
  .middleware([adminMiddleware])
  .validator(z.object({ key: z.string().min(1) }))
  .handler(async ({ data }) => {
    await db.delete(settings).where(eq(settings.key, data.key));
  });

export const settingsQueries = {
  all: () => ['settings'] as const,
  list: () =>
    queryOptions({
      queryKey: ['settings', 'list'] as const,
      queryFn: () => listSettings()
    }),
  get: (key: string) =>
    queryOptions({
      queryKey: ['settings', 'get', key] as const,
      queryFn: () => getSetting({ data: { key } })
    }),
  defaults: () =>
    queryOptions({
      queryKey: ['settings', 'defaults'] as const,
      queryFn: () => getSettingDefaults()
    }),
  system: () =>
    queryOptions({
      queryKey: ['settings', 'system'] as const,
      queryFn: () => getSystemSettingsFn()
    })
};
