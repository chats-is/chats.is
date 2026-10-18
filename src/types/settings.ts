import { z } from 'zod';

import { SITE_PAGES } from '@/lib/constant';

import {
  graceDaysSchema,
  refundDaysSchema,
  refundFeeSchema,
  refundRequestsSchema
} from './payment';

/**
 * What the settings server functions accept.
 *
 * Settings are addressed by key rather than id, so a write is an upsert and
 * there is no separate create.
 */
export const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().nullable()
});

/** A bulk write is the same row shape, several at a time. */
export const settingsBulkSchema = z.array(settingSchema);

export const settingKeySchema = z.object({ key: z.string().min(1) });

/**
 * The settings whose value is more than any string, each with what it must
 * be. An empty value is always allowed: the setting's default.
 */
export const SETTING_VALUE_SCHEMAS: Record<string, z.ZodType> = {
  'subscriptions.graceDays': graceDaysSchema,
  'refunds.fee': refundFeeSchema,
  'refunds.days': refundDaysSchema,
  'refunds.maxRequests': refundRequestsSchema
};

/** Which of the site's own pages to read: the one public read of the
 *  settings table by key, so it names the only keys it may reach. */
export const sitePageSchema = z.object({ page: z.enum(SITE_PAGES) });

export type SitePage = z.infer<typeof sitePageSchema>['page'];
