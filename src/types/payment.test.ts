import { describe, expect, it } from 'vitest';

import { canUpgrade } from '@/types/payment';

describe('canUpgrade', () => {
  const on = (processor: string, price: number) =>
    ({ price, interval: 'month', processor }) as const;

  it('moves up in place, at the same interval and processor', () => {
    expect(canUpgrade(on('stripe', 10), on('stripe', 20))).toBe(true);
    expect(canUpgrade(on('paddle', 10), on('paddle', 20))).toBe(true);
  });

  it('never in place through Lemon Squeezy', () => {
    expect(canUpgrade(on('lemonsqueezy', 10), on('lemonsqueezy', 20))).toBe(
      false
    );
  });

  it('not down, across processors, or to another interval', () => {
    expect(canUpgrade(on('stripe', 20), on('stripe', 10))).toBe(false);
    expect(canUpgrade(on('stripe', 10), on('paddle', 20))).toBe(false);
    expect(
      canUpgrade(on('stripe', 10), { ...on('stripe', 20), interval: 'year' })
    ).toBe(false);
  });
});
