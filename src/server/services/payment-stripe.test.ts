import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Stripe adapter against a stand-in for the Stripe SDK: the order of the
 * requests an upgrade makes, and what it puts back when the change does not
 * go through.
 */

vi.mock('@/lib/env', () => ({
  env: { STRIPE_SECRET_KEY: 'sk_test_key', STRIPE_WEBHOOK_SECRET: 'whsec' }
}));

const stripe = {
  subscriptions: { retrieve: vi.fn(), update: vi.fn() }
};

vi.mock('stripe', () => ({
  default: vi.fn(function Stripe() {
    return stripe;
  })
}));

const { createStripeProcessor } = await import('./payment-stripe');

const current = {
  id: 'sub_1',
  cancel_at_period_end: true,
  metadata: { planId: 'go' },
  items: { data: [{ id: 'si_1' }] }
};

beforeEach(() => {
  stripe.subscriptions.retrieve.mockReset().mockResolvedValue(current);
  stripe.subscriptions.update.mockReset().mockResolvedValue({});
});

describe('upgrading on Stripe', () => {
  const upgrade = () =>
    createStripeProcessor().changeNow('sub_1', {
      priceId: 'price_pro',
      planId: 'pro'
    });

  it('charges last, after what costs nothing', async () => {
    await upgrade();
    expect(stripe.subscriptions.update.mock.calls).toEqual([
      ['sub_1', { cancel_at_period_end: false, metadata: { planId: 'pro' } }],
      [
        'sub_1',
        {
          items: [{ id: 'si_1', price: 'price_pro' }],
          proration_behavior: 'always_invoice',
          payment_behavior: 'pending_if_incomplete'
        }
      ]
    ]);
  });

  it('puts back what went first when the charge is declined', async () => {
    stripe.subscriptions.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ pending_update: { expires_at: 1 } });
    await expect(upgrade()).rejects.toThrow('did not go through');
    expect(stripe.subscriptions.update).toHaveBeenLastCalledWith('sub_1', {
      cancel_at_period_end: true,
      metadata: { planId: 'go' }
    });
  });

  it('puts it back when the change fails', async () => {
    stripe.subscriptions.update
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('down'));
    await expect(upgrade()).rejects.toThrow('down');
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(3);
  });
});
