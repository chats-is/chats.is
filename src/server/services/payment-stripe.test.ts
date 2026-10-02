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
  invoices: { createPreview: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { list: vi.fn() },
  disputes: { list: vi.fn() }
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

describe('a Stripe dispute', () => {
  const action = async (type: string, object: Record<string, unknown>) => {
    stripe.webhooks.constructEventAsync.mockResolvedValueOnce({
      id: 'evt_1',
      type,
      data: { object }
    });
    const event = await createStripeProcessor().parseWebhook(
      '{}',
      new Headers({ 'stripe-signature': 'sig' })
    );
    return event.action;
  };

  it('under inquiry has taken no money; a chargeback has', async () => {
    expect(
      await action('charge.dispute.created', {
        payment_intent: 'pi_1',
        status: 'warning_needs_response'
      })
    ).toEqual({ kind: 'dispute', transactionId: 'pi_1', withdrawn: false });
    expect(
      await action('charge.dispute.created', {
        payment_intent: 'pi_1',
        status: 'needs_response'
      })
    ).toEqual({ kind: 'dispute', transactionId: 'pi_1', withdrawn: true });
    expect(
      await action('charge.dispute.funds_withdrawn', {
        payment_intent: 'pi_1',
        status: 'warning_needs_response'
      })
    ).toEqual({ kind: 'dispute', transactionId: 'pi_1', withdrawn: true });
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

describe('where a Stripe payment stands', () => {
  const state = async (
    refunds: Array<{ status: string }>,
    disputes: Array<{ status: string }>
  ) => {
    stripe.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_1', amount_refunded: 800, currency: 'usd' }
    });
    stripe.refunds.list.mockResolvedValue({ data: refunds });
    stripe.disputes.list.mockResolvedValue({ data: disputes });
    return await createStripeProcessor().getPaymentState({
      externalId: 'in_1',
      transactionId: 'pi_1'
    });
  };

  it('is what was refunded of its charge, and whether a refund still waits', async () => {
    expect(await state([{ status: 'succeeded' }], [])).toEqual({
      refunded: 8,
      refundPending: false,
      dispute: 'none'
    });
    expect(await state([{ status: 'pending' }], [])).toMatchObject({
      refundPending: true
    });
  });

  it('and its disputes: an inquiry, the money taken, or given back', async () => {
    const dispute = async (...statuses: Array<string>) =>
      (
        await state(
          [],
          statuses.map(status => ({ status }))
        )
      ).dispute;
    expect(await dispute('warning_needs_response')).toBe('inquiry');
    expect(await dispute('needs_response')).toBe('withdrawn');
    expect(await dispute('lost')).toBe('withdrawn');
    expect(await dispute('won')).toBe('won');
    expect(await dispute('warning_closed')).toBe('won');
    expect(await dispute('won', 'needs_response')).toBe('withdrawn');
  });

  it('with no transaction, nothing', async () => {
    expect(
      await createStripeProcessor().getPaymentState({
        externalId: 'in_1',
        transactionId: null
      })
    ).toEqual({ refunded: 0, refundPending: false, dispute: 'none' });
  });
});
