import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Stripe adapter against a stand-in for the Stripe SDK: the request an
 * upgrade makes, and what a webhook carries — as Stripe sends it.
 */

vi.mock('@/lib/env', () => ({
  env: { STRIPE_SECRET_KEY: 'sk_test_key', STRIPE_WEBHOOK_SECRET: 'whsec' }
}));

const stripe = {
  subscriptions: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
  webhooks: { constructEventAsync: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn(), create: vi.fn() } },
  prices: { retrieve: vi.fn() },
  invoices: {
    createPreview: vi.fn(),
    retrieve: vi.fn(),
    list: vi.fn(),
    voidInvoice: vi.fn()
  },
  paymentIntents: { retrieve: vi.fn() },
  refunds: { retrieve: vi.fn() },
  tax: { settings: { retrieve: vi.fn() } }
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

describe('ending a subscription on Stripe', () => {
  beforeEach(() => {
    stripe.subscriptions.cancel.mockReset().mockResolvedValue({});
    stripe.invoices.list.mockReset().mockResolvedValue({ data: [] });
    stripe.invoices.voidInvoice.mockReset().mockResolvedValue({});
  });

  it('cancels it, and voids the renewal it left unpaid, which could otherwise still be paid', async () => {
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ status: 'past_due' });
    stripe.invoices.list.mockResolvedValueOnce({ data: [{ id: 'in_2' }] });
    await createStripeProcessor().end('sub_1');
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
    expect(stripe.invoices.list).toHaveBeenCalledWith({
      subscription: 'sub_1',
      status: 'open',
      limit: 100
    });
    expect(stripe.invoices.voidInvoice.mock.calls).toEqual([['in_2']]);
  });

  it('already canceled, still voids what it left unpaid', async () => {
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ status: 'canceled' });
    stripe.invoices.list.mockResolvedValueOnce({ data: [{ id: 'in_2' }] });
    await createStripeProcessor().end('sub_1');
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.invoices.voidInvoice.mock.calls).toEqual([['in_2']]);
  });
});

describe('upgrading on Stripe', () => {
  const upgrade = () =>
    createStripeProcessor().changeNow('sub_1', {
      priceId: 'price_pro',
      planId: 'pro'
    });

  it('changes the price, the plan it names and staying in one request, charged at once', async () => {
    await upgrade();
    expect(stripe.subscriptions.update.mock.calls).toEqual([
      [
        'sub_1',
        {
          items: [{ id: 'si_1', price: 'price_pro' }],
          cancel_at_period_end: false,
          metadata: { planId: 'pro' },
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete'
        }
      ]
    ]);
  });

  it('says so when the charge is declined, and changes nothing more', async () => {
    stripe.subscriptions.update.mockRejectedValueOnce(
      Object.assign(new Error('Your card was declined.'), {
        type: 'StripeCardError'
      })
    );
    await expect(upgrade()).rejects.toThrow('did not go through');
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });

  it('passes on any other failure', async () => {
    stripe.subscriptions.update.mockRejectedValueOnce(new Error('down'));
    await expect(upgrade()).rejects.toThrow('down');
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

  /** An invoice as a webhook carries it: without its payments. */
  const invoice = (lines: Array<Record<string, unknown>>, reason: string) => ({
    id: 'in_1',
    customer: 'cus_1',
    status: 'paid',
    amount_paid: 1000,
    amount_due: 1000,
    currency: 'usd',
    billing_reason: reason,
    hosted_invoice_url: 'https://stripe/in_1',
    parent: {
      subscription_details: {
        subscription: 'sub_1',
        metadata: { userId: 'u1', planId: 'pro' }
      }
    },
    lines: { data: lines }
  });

  beforeEach(() => {
    stripe.invoices.retrieve.mockReset().mockResolvedValue({
      payments: {
        data: [{ status: 'paid', payment: { payment_intent: 'pi_1' } }]
      }
    });
  });

  it('carries an invoice as a payment, with the user, plan, price and period it names — and the transaction that paid it, read', async () => {
    expect(
      await action(
        'invoice.paid',
        invoice(
          [
            {
              amount: 1000,
              pricing: { price_details: { price: 'price_1' } },
              period: { end: 1790000000 }
            }
          ],
          'subscription_cycle'
        )
      )
    ).toEqual({
      kind: 'payment',
      payment: expect.objectContaining({
        externalId: 'in_1',
        externalSubscriptionId: 'sub_1',
        userId: 'u1',
        planId: 'pro',
        priceId: 'price_1',
        periodEnd: new Date(1790000000 * 1000),
        transactionId: 'pi_1',
        amount: 10,
        kind: 'renewal',
        paid: true
      })
    });
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_1', {
      expand: ['payments']
    });
  });

  it('reads the fee Stripe kept on a paid invoice, in the charge’s currency', async () => {
    stripe.paymentIntents.retrieve.mockReset().mockResolvedValue({
      latest_charge: {
        balance_transaction: { fee: 698, exchange_rate: 7.84775 }
      }
    });
    const lines = [
      { amount: 1000, pricing: { price_details: { price: 'price_1' } } }
    ];
    expect(
      await action('invoice.paid', invoice(lines, 'subscription_cycle'))
    ).toEqual({
      kind: 'payment',
      payment: expect.objectContaining({ fee: 0.89, paid: true })
    });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', {
      expand: ['latest_charge.balance_transaction']
    });

    stripe.paymentIntents.retrieve.mockClear();
    expect(
      await action('invoice.payment_failed', {
        ...invoice(lines, 'subscription_cycle'),
        status: 'open'
      })
    ).toEqual({
      kind: 'payment',
      payment: expect.objectContaining({ fee: null, paid: false })
    });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('keeps the tax on an invoice as the seller’s own, never as Stripe’s', async () => {
    const taxed = {
      ...invoice(
        [{ amount: 1000, pricing: { price_details: { price: 'price_1' } } }],
        'subscription_create'
      ),
      amount_paid: 1100,
      total_taxes: [
        { amount: 80, tax_behavior: 'exclusive' },
        { amount: 20, tax_behavior: 'exclusive' }
      ]
    };
    expect(await action('invoice.paid', taxed)).toEqual({
      kind: 'payment',
      payment: expect.objectContaining({ amount: 11, tax: null, sellerTax: 1 })
    });
    expect(await action('invoice.paid', { ...taxed, total_taxes: [] })).toEqual(
      {
        kind: 'payment',
        payment: expect.objectContaining({ tax: null, sellerTax: null })
      }
    );
  });

  it("takes an upgrade's price from the line that charges, not the credit before it", async () => {
    expect(
      await action(
        'invoice.paid',
        invoice(
          [
            {
              amount: -500,
              pricing: { price_details: { price: 'price_go' } },
              period: { end: 1790000000 }
            },
            {
              amount: 1500,
              pricing: { price_details: { price: 'price_pro' } },
              period: { end: 1790000000 }
            }
          ],
          'subscription_update'
        )
      )
    ).toEqual({
      kind: 'payment',
      payment: expect.objectContaining({
        priceId: 'price_pro',
        kind: 'upgrade'
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

  it('carries a refund that failed after it succeeded, told by refund.failed', async () => {
    expect(
      await action('refund.failed', {
        id: 're_1',
        payment_intent: 'pi_1',
        amount: 800,
        currency: 'usd',
        status: 'failed',
        failure_reason: 'expired_or_canceled_card'
      })
    ).toEqual({
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

describe('the fee on a Stripe payment', () => {
  /** A payment of $10.00, with the balance transaction Stripe kept. */
  const feeWith = async (txn: Record<string, unknown>) => {
    stripe.invoices.retrieve.mockResolvedValueOnce({
      id: 'in_1',
      status: 'paid',
      amount_paid: 1000,
      amount_due: 1000,
      billing_reason: 'subscription_create',
      lines: { data: [{ amount: 1000 }] },
      payments: {
        data: [{ status: 'paid', payment: { payment_intent: 'pi_1' } }]
      }
    });
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({
      latest_charge: { balance_transaction: txn }
    });
    return (await createStripeProcessor().getPayment('in_1'))?.fee;
  };

  it('is the fee Stripe kept, where the account settles in the charge’s currency', async () => {
    expect(
      await feeWith({
        amount: 1000,
        currency: 'usd',
        fee: 59,
        exchange_rate: null
      })
    ).toBe(0.59);
  });

  it('goes back into the charge’s currency, at Stripe’s rate, where the account settles in another', async () => {
    // $10.00 into an account in Hong Kong dollars: HK$78.48, its fee HK$6.98.
    expect(
      await feeWith({
        amount: 7848,
        currency: 'hkd',
        fee: 698,
        exchange_rate: 7.84776
      })
    ).toBe(0.89);
  });
});

describe('a Stripe checkout', () => {
  const input = {
    userId: 'u1',
    planId: 'pro',
    priceId: 'price_1',
    email: 'u1@test.com',
    customerId: null as string | null,
    origin: 'https://app',
    successUrl: 'https://app/back?x=1',
    cancelUrl: 'https://app/plans'
  };

  beforeEach(() => {
    stripe.checkout.sessions.create
      .mockReset()
      .mockResolvedValue({ url: 'https://checkout.stripe/s_1' });
  });

  it('asks Stripe for no tax while Stripe Tax is not set up', async () => {
    stripe.tax.settings.retrieve.mockResolvedValue({ status: 'pending' });
    await createStripeProcessor().createCheckout(input);
    const params = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params).not.toHaveProperty('automatic_tax');
    expect(params).not.toHaveProperty('customer_update');
  });

  it('has Stripe work out the tax once Stripe Tax is set up, from the address a kept customer gives', async () => {
    stripe.tax.settings.retrieve.mockResolvedValue({ status: 'active' });
    await createStripeProcessor().createCheckout(input);
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({
      automatic_tax: { enabled: true }
    });
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).not.toHaveProperty(
      'customer_update'
    );

    await createStripeProcessor().createCheckout({
      ...input,
      customerId: 'cus_1'
    });
    expect(stripe.checkout.sessions.create.mock.calls[1][0]).toMatchObject({
      customer: 'cus_1',
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto' }
    });
  });
});
