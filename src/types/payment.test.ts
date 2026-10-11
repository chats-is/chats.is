import { describe, expect, it } from 'vitest';

import { canUpgrade, refundShareMinor } from '@/types/payment';

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

describe('refundShareMinor on auto', () => {
  it('gives back all but the fee where there is no tax in it', () => {
    expect(
      refundShareMinor({ amount: '10.00', fee: '0.89', tax: null }, null)
    ).toBe(911);
  });

  it('leaves the seller even where a merchant processor holds the tax', () => {
    // $12 with $2 tax and a $0.89 fee: the seller has $9.11, and gives back
    // 10.93 × 10/12 of it.
    expect(
      refundShareMinor({ amount: '12.00', fee: '0.89', tax: '2.00' }, null)
    ).toBe(1093);
  });

  it('comes to the same where the tax is the seller’s own, through Stripe', () => {
    // Stripe Tax takes back 2 × 10.93/12 of the tax with the refund; the
    // seller still owes the rest, on the 1.07 they keep.
    expect(
      refundShareMinor(
        { amount: '12.00', fee: '0.89', tax: null, sellerTax: '2.00' },
        null
      )
    ).toBe(1093);
  });

  it('takes a refund fee as a share of what was paid, tax or not', () => {
    expect(
      refundShareMinor(
        { amount: '12.00', fee: '0.89', tax: null, sellerTax: '2.00' },
        20
      )
    ).toBe(960);
  });
});
