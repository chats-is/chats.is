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
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  webhooks: { constructEventAsync: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn(), create: vi.fn() } },
  prices: { retrieve: vi.fn() },
  invoices: { createPreview: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { retrieve: vi.fn() }
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

const AT = new Date('2026-09-01T00:00:00Z');

/** What one Stripe event, signed, asks for. */
const action = async (type: string, object: Record<string, unknown>) => {
  stripe.webhooks.constructEventAsync.mockResolvedValueOnce({
    id: 'evt_1',
    type,
    created: AT.getTime() / 1000,
    data: { object }
  });
  const event = await createStripeProcessor().parseWebhook(
    '{}',
    new Headers({ 'stripe-signature': 'sig' })
  );
  return event.action;
};

describe('a Stripe webhook', () => {
  it('carries the subscription as it is, and when', async () => {
    expect(
      await action('customer.subscription.updated', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        metadata: { userId: 'u1', planId: 'pro' },
        items: {
          data: [{ price: { id: 'price_1' }, current_period_end: 1790000000 }]
        }
      })
    ).toEqual({
      kind: 'subscription',
      subscription: expect.objectContaining({
        externalId: 'sub_1',
        customerId: 'cus_1',
        userId: 'u1',
        planId: 'pro',
        priceId: 'price_1',
        status: 'active',
        periodEnd: new Date(1790000000 * 1000)
      })
    });
  });

  it('carries an invoice as a payment, with the user, plan, price and period it names', async () => {
    expect(
      await action('invoice.paid', {
        id: 'in_1',
        customer: 'cus_1',
        status: 'paid',
        amount_paid: 1000,
        amount_due: 1000,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
        hosted_invoice_url: 'https://stripe/in_1',
        parent: {
          subscription_details: {
            subscription: 'sub_1',
            metadata: { userId: 'u1', planId: 'pro' }
          }
        },
        payments: {
          data: [{ payment: { payment_intent: 'pi_1' } }]
        },
        lines: {
          data: [
            {
              pricing: { price_details: { price: 'price_1' } },
              period: { end: 1790000000 }
            }
          ]
        }
      })
    ).toEqual({
      kind: 'payment',
      payment: expect.objectContaining({
        externalId: 'in_1',
        externalSubscriptionId: 'sub_1',
        userId: 'u1',
        planId: 'pro',
        priceId: 'price_1',
        periodEnd: new Date(1790000000 * 1000),
        amount: 10,
        kind: 'renewal',
        paid: true
      })
    });
  });

  it('carries a refund by its id, with its amount and whether it went through', async () => {
    const refund = (status: string) => ({
      id: 're_1',
      payment_intent: 'pi_1',
      amount: 800,
      currency: 'usd',
      status
    });
    expect(await action('refund.created', refund('pending'))).toEqual({
      kind: 'refund',
      transactionId: 'pi_1',
      refund: { externalId: 're_1', amount: 8, total: null, status: 'pending' }
    });
    expect(await action('refund.updated', refund('succeeded'))).toEqual({
      kind: 'refund',
      transactionId: 'pi_1',
      refund: {
        externalId: 're_1',
        amount: 8,
        total: null,
        status: 'succeeded'
      }
    });
    expect(await action('refund.updated', refund('failed'))).toEqual({
      kind: 'refund',
      transactionId: 'pi_1',
      refund: { externalId: 're_1', amount: 8, total: null, status: 'failed' }
    });
  });
});

describe('a Stripe dispute', () => {
  it('under inquiry has taken no money; a chargeback has', async () => {
    expect(
      await action('charge.dispute.created', {
        payment_intent: 'pi_1',
        status: 'warning_needs_response'
      })
    ).toEqual({
      kind: 'dispute',
      transactionId: 'pi_1',
      withdrawn: false
    });
    expect(
      await action('charge.dispute.created', {
        payment_intent: 'pi_1',
        status: 'needs_response'
      })
    ).toEqual({
      kind: 'dispute',
      transactionId: 'pi_1',
      withdrawn: true
    });
    expect(
      await action('charge.dispute.funds_withdrawn', {
        payment_intent: 'pi_1',
        status: 'warning_needs_response'
      })
    ).toEqual({
      kind: 'dispute',
      transactionId: 'pi_1',
      withdrawn: true
    });
  });

  it('won, or closed as an inquiry, is won; lost is left as it is', async () => {
    expect(
      await action('charge.dispute.closed', {
        payment_intent: 'pi_1',
        status: 'won'
      })
    ).toEqual({ kind: 'dispute_won', transactionId: 'pi_1' });
    expect(
      await action('charge.dispute.closed', {
        payment_intent: 'pi_1',
        status: 'warning_closed'
      })
    ).toEqual({ kind: 'dispute_won', transactionId: 'pi_1' });
    expect(
      await action('charge.dispute.funds_reinstated', {
        charge: 'ch_1',
        status: 'won'
      })
    ).toEqual({ kind: 'dispute_won', transactionId: 'ch_1' });
    expect(
      await action('charge.dispute.closed', {
        payment_intent: 'pi_1',
        status: 'lost'
      })
    ).toEqual({ kind: 'ignore' });
  });
});

describe('asking Stripe', () => {
  /** A Stripe price of $200, renewing as given. */
  const price = (recurring: Record<string, unknown> | null) => ({
    id: 'price_pro',
    active: true,
    unit_amount: 20000,
    recurring
  });

  it('for a price in dollars, with its interval', async () => {
    stripe.prices.retrieve.mockResolvedValue(
      price({ interval: 'year', interval_count: 1, usage_type: 'licensed' })
    );
    expect(await createStripeProcessor().getPrice('price_pro')).toEqual({
      priceId: 'price_pro',
      amount: 200,
      interval: 'year',
      active: true,
      metered: false,
      maxQuantity: null
    });
  });

  it('for a price every day or week, with its interval', async () => {
    for (const interval of ['day', 'week']) {
      stripe.prices.retrieve.mockResolvedValue(
        price({ interval, interval_count: 1, usage_type: 'licensed' })
      );
      expect(
        (await createStripeProcessor().getPrice('price_pro')).interval
      ).toBe(interval);
    }
  });

  it('for a price every three months, or once, as no interval it can sell', async () => {
    stripe.prices.retrieve.mockResolvedValue(
      price({ interval: 'month', interval_count: 3, usage_type: 'licensed' })
    );
    expect(
      (await createStripeProcessor().getPrice('price_pro')).interval
    ).toBeNull();
    stripe.prices.retrieve.mockResolvedValue(price(null));
    expect(
      (await createStripeProcessor().getPrice('price_pro')).interval
    ).toBeNull();
  });

  it('for the subscription a checkout made, only for the user it was made for', async () => {
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: 'u1',
      subscription: 'sub_1'
    });
    const find = (userId: string) =>
      createStripeProcessor().findSubscriptions({
        ref: 'cs_1',
        userId,
        email: 'u1@test.com'
      });
    expect(await find('u1')).toEqual(['sub_1']);
    expect(await find('u2')).toEqual([]);
    expect(
      await createStripeProcessor().findSubscriptions({
        ref: null,
        userId: 'u1',
        email: 'u1@test.com'
      })
    ).toEqual([]);
  });

  it('what an upgrade charges today', async () => {
    stripe.invoices.createPreview.mockResolvedValue({
      amount_due: 750,
      currency: 'usd'
    });
    expect(
      await createStripeProcessor().previewChange('sub_1', {
        priceId: 'price_pro'
      })
    ).toBe(7.5);
    expect(stripe.invoices.createPreview).toHaveBeenCalledWith({
      subscription: 'sub_1',
      subscription_details: {
        items: [{ id: 'si_1', price: 'price_pro' }],
        proration_behavior: 'always_invoice'
      }
    });
  });
});

describe('a Stripe refund, read by its id', () => {
  it('is the refund as Stripe has it now', async () => {
    const read = async (status: string) => {
      stripe.refunds.retrieve.mockResolvedValue({
        id: 're_1',
        payment_intent: 'pi_1',
        amount: 800,
        currency: 'usd',
        status
      });
      return await createStripeProcessor().getRefund(
        { externalId: 'in_1', transactionId: 'pi_1' },
        're_1'
      );
    };
    expect(await read('succeeded')).toEqual({
      externalId: 're_1',
      amount: 8,
      total: null,
      status: 'succeeded'
    });
    expect(stripe.refunds.retrieve).toHaveBeenCalledWith('re_1');
    expect((await read('pending')).status).toBe('pending');
    expect((await read('canceled')).status).toBe('failed');
  });
});
