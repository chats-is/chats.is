/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's quota
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import {
  quotaCreateSchema,
  quotaUpdateSchema,
  validateQuotaLimits
} from './quota';

describe('quota', () => {
  it('takes a positive number, an empty string, or null as a limit', () => {
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: 5 }).success
    ).toBe(true);
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: '' }).success
    ).toBe(true);
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: null }).success
    ).toBe(true);
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: -1 }).success
    ).toBe(false);
  });

  it('defaults a new quota to no limits and no model restriction', () => {
    const r = quotaCreateSchema.parse({ name: 'q' });
    expect(r.fiveHour).toBeNull();
    expect(r.sevenDay).toBeNull();
    expect(r.isUnlimited).toBe(false);
    expect(r.allowedModelIds).toEqual([]);
  });

  it('leaves limits absent on update rather than defaulting them', () => {
    expect('fiveHour' in quotaUpdateSchema.parse({ id: 'i' })).toBe(false);
  });

  it('holds the 5-hour limit to a quarter of the weekly one', () => {
    expect(() =>
      validateQuotaLimits({ fiveHour: 25, sevenDay: 100 })
    ).not.toThrow();
    expect(() => validateQuotaLimits({ fiveHour: 26, sevenDay: 100 })).toThrow(
      /25% of weekly/
    );
    expect(() =>
      validateQuotaLimits({ fiveHour: 999, sevenDay: null })
    ).not.toThrow();
    expect(() =>
      validateQuotaLimits({ fiveHour: null, sevenDay: 100 })
    ).not.toThrow();
  });

  /** The console form must not accept a name or description the server will
   *  reject; that is a round trip the user pays for. */
  it('caps a name at 100 and a description at 500', () => {
    expect(quotaCreateSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(
      false
    );
    expect(
      quotaCreateSchema.safeParse({ name: 'q', description: 'd'.repeat(501) })
        .success
    ).toBe(false);
  });
});
