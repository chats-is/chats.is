import { describe, expect, it } from 'vitest';

import { priceMultiplierSchema, tierCreateSchema } from './tier';

describe('priceMultiplierSchema', () => {
  it('takes a number, or its text, above 0', () => {
    expect(priceMultiplierSchema.parse(1.5)).toBe('1.5');
    expect(priceMultiplierSchema.parse('0.5')).toBe('0.5');
    expect(priceMultiplierSchema.parse(' 2 ')).toBe('2');
  });

  it('refuses blank, words, negatives and 0 — nothing is free', () => {
    expect(priceMultiplierSchema.safeParse('').success).toBe(false);
    expect(priceMultiplierSchema.safeParse('abc').success).toBe(false);
    expect(priceMultiplierSchema.safeParse('-1').success).toBe(false);
    expect(priceMultiplierSchema.safeParse('0').success).toBe(false);
    expect(priceMultiplierSchema.safeParse(0).success).toBe(false);
    expect(priceMultiplierSchema.safeParse(null).success).toBe(false);
    expect(priceMultiplierSchema.safeParse(undefined).success).toBe(false);
  });

  it('is required on a new tier', () => {
    expect(tierCreateSchema.safeParse({ name: 'Tier1' }).success).toBe(false);
    expect(
      tierCreateSchema.safeParse({ name: 'Tier1', priceMultiplier: '1' })
        .success
    ).toBe(true);
  });
});
