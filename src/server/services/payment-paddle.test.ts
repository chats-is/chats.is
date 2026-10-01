import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Paddle adapter against a stand-in for Paddle's API: what it sends, and
 * how it reads what comes back and what its webhooks say.
 */

vi.mock('@/lib/env', () => ({
  env: {
    PADDLE_API_KEY: 'pdl_sdbx_apikey_test',
    PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret',
    PADDLE_CLIENT_TOKEN: 'test_token'
  }
}));

const { createPaddleProcessor, paddleCheckoutConfig, __test } =
  await import('./payment-paddle');

type Call = { method: string; url: string; body: any };
let calls: Call[];
let replies: Array<{ status?: number; body: unknown }>;

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined
      });
      const reply = replies.shift() ?? { body: { data: {} } };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const paddle = createPaddleProcessor();

const subscription = (extra: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  status: 'active',
  customer_id: 'ctm_1',
  custom_data: { userId: 'u1', planId: 'pro', note: 'kept' },
  items: [{ price: { id: 'pri_pro' } }],
  current_billing_period: {
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2026-10-01T00:00:00Z'
  },
  scheduled_change: null,
  canceled_at: null,
  ...extra
});

describe('the Paddle API', () => {
  it('uses the sandbox for sandbox keys', async () => {
    replies.push({ body: { data: subscription() } });
    await paddle.getSubscription('sub_1');
    expect(calls[0].url).toBe(
      'https://sandbox-api.paddle.com/subscriptions/sub_1'
    );
    expect(await paddleCheckoutConfig()).toEqual({
      clientToken: 'test_token',
      sandbox: true
    });
  });

  it('reads a price in dollars, with its interval', async () => {
    replies.push({
      body: {
        data: {
          id: 'pri_pro',
          status: 'active',
          billing_cycle: { interval: 'year', frequency: 1 },
          unit_price: { amount: '20000', currency_code: 'USD' },
          quantity: { minimum: 1, maximum: 999999 }
        }
      }
    });
    expect(await paddle.getPrice('pri_pro')).toEqual({
      priceId: 'pri_pro',
      amount: 200,
      currency: 'usd',
      interval: 'year',
      active: true,
      metered: false,
      maxQuantity: 999999
    });
  });

  it('reads every three months as no interval it can sell', async () => {
    replies.push({
      body: {
        data: {
          id: 'pri_q',
          status: 'active',
          billing_cycle: { interval: 'month', frequency: 3 },
          unit_price: { amount: '100', currency_code: 'USD' }
        }
      }
    });
    expect((await paddle.getPrice('pri_q')).interval).toBeNull();
  });

  it('says a price it has not got is not there', async () => {
    replies.push({ status: 404, body: { error: { code: 'not_found' } } });
    await expect(paddle.getPrice('pri_x')).rejects.toThrow(
      'Paddle has no price pri_x.'
    );
  });

  it('opens checkout as a transaction on the app’s own page', async () => {
    replies.push({
      body: {
        data: {
          id: 'txn_1',
          checkout: { url: 'https://app.example/pay/paddle?_ptxn=txn_1' }
        }
      }
    });
    const url = await paddle.createCheckout({
      customerId: 'ctm_1',
      email: 'u1@test.com',
      priceId: 'pri_pro',
      userId: 'u1',
      planId: 'pro',
      origin: 'https://app.example',
      successUrl: 'https://app.example/?checkout=success',
      cancelUrl: 'https://app.example/?checkout=canceled'
    });
    expect(url).toBe('https://app.example/pay/paddle?_ptxn=txn_1');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: {
        items: [{ price_id: 'pri_pro', quantity: 1 }],
        customer_id: 'ctm_1',
        custom_data: { userId: 'u1', planId: 'pro' },
        checkout: { url: 'https://app.example/pay/paddle' }
      }
    });
  });

  it('checks out a user new to Paddle as the customer with their email', async () => {
    replies.push(
      { body: { data: [{ id: 'ctm_known' }] } },
      {
        body: {
          data: { id: 'txn_1', checkout: { url: 'https://x/?_ptxn=txn_1' } }
        }
      }
    );
    await paddle.createCheckout({
      customerId: null,
      email: 'u1+a@test.com',
      priceId: 'pri_pro',
      userId: 'u1',
      planId: 'pro',
      origin: 'https://app.example',
      successUrl: 'https://app.example/?checkout=success',
      cancelUrl: 'https://app.example/?checkout=canceled'
    });
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: expect.stringContaining('/customers?email=u1%2Ba%40test.com')
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: { customer_id: 'ctm_known' }
    });
  });

  it('makes the customer when Paddle has none with the email', async () => {
    replies.push(
      { body: { data: [] } },
      { body: { data: { id: 'ctm_new' } } },
      {
        body: {
          data: { id: 'txn_1', checkout: { url: 'https://x/?_ptxn=txn_1' } }
        }
      }
    );
    await paddle.createCheckout({
      customerId: null,
      email: 'u1@test.com',
      priceId: 'pri_pro',
      userId: 'u1',
      planId: 'pro',
      origin: 'https://app.example',
      successUrl: 'https://app.example/?checkout=success',
      cancelUrl: 'https://app.example/?checkout=canceled'
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: { email: 'u1@test.com' }
    });
    expect(calls[2]).toMatchObject({ body: { customer_id: 'ctm_new' } });
  });

  it('switches now, charged at once, keeping the custom data', async () => {
    replies.push({ body: { data: subscription() } }, { body: { data: {} } });
    await paddle.changeNow('sub_1', { priceId: 'pri_max', planId: 'max' });
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      body: {
        items: [{ price_id: 'pri_max', quantity: 1 }],
        proration_billing_mode: 'prorated_immediately',
        on_payment_failure: 'prevent_change',
        custom_data: { userId: 'u1', planId: 'max', note: 'kept' }
      }
    });
  });

  it('drops a scheduled cancellation on its own before the switch, and puts it back if the switch fails', async () => {
    const canceling = subscription({
      scheduled_change: { action: 'cancel', effective_at: '2026-10-01' }
    });
    replies.push(
      { body: { data: canceling } },
      { body: { data: {} } },
      { body: { data: {} } }
    );
    await paddle.changeNow('sub_1', { priceId: 'pri_max', planId: 'max' });
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      body: { scheduled_change: null }
    });
    expect(calls[2].body).toMatchObject({
      items: [{ price_id: 'pri_max', quantity: 1 }]
    });
    expect(calls[2].body).not.toHaveProperty('scheduled_change');

    calls = [];
    replies.push(
      { body: { data: canceling } },
      { body: { data: {} } },
      { status: 400, body: { error: { code: 'bad_request' } } },
      { body: { data: {} } }
    );
    await expect(
      paddle.changeNow('sub_1', { priceId: 'pri_max', planId: 'max' })
    ).rejects.toThrow('could not be made');
    expect(calls[3]).toMatchObject({
      method: 'POST',
      body: { effective_from: 'next_billing_period' }
    });
  });

  it('says so when the charge for a switch is declined', async () => {
    replies.push(
      { body: { data: subscription() } },
      {
        status: 400,
        body: { error: { code: 'subscription_payment_declined' } }
      }
    );
    await expect(
      paddle.changeNow('sub_1', { priceId: 'pri_max', planId: 'max' })
    ).rejects.toThrow('did not go through');
  });

  it('cancels at the period end, resumes, and cancels at once', async () => {
    await paddle.cancelAtPeriodEnd('sub_1');
    await paddle.resume('sub_1');
    replies.push({ body: { data: subscription() } }, { body: { data: {} } });
    await paddle.cancelNow('sub_1');
    expect(
      calls.map(c => [c.method, c.url.replace(/^.*\.com/, ''), c.body])
    ).toEqual([
      [
        'POST',
        '/subscriptions/sub_1/cancel',
        { effective_from: 'next_billing_period' }
      ],
      ['PATCH', '/subscriptions/sub_1', { scheduled_change: null }],
      ['GET', '/subscriptions/sub_1', undefined],
      ['POST', '/subscriptions/sub_1/cancel', { effective_from: 'immediately' }]
    ]);
  });

  it('reads a completed transaction as a payment in dollars', async () => {
    replies.push({
      body: {
        data: {
          id: 'txn_1',
          status: 'completed',
          subscription_id: 'sub_1',
          customer_id: 'ctm_1',
          currency_code: 'USD',
          details: { totals: { grand_total: '1050' } },
          billed_at: '2026-09-01T00:00:00Z',
          created_at: '2026-09-01T00:00:00Z'
        }
      }
    });
    expect(await paddle.getPayment('txn_1')).toMatchObject({
      externalId: 'txn_1',
      transactionId: 'txn_1',
      subscriptionExternalId: 'sub_1',
      amount: 10.5,
      paid: true
    });
  });

  it('opens the payment method page of the customer portal', async () => {
    replies.push({
      body: {
        data: {
          urls: {
            general: { overview: 'https://portal/overview' },
            subscriptions: [
              {
                id: 'sub_1',
                update_subscription_payment_method: 'https://portal/pm'
              }
            ]
          }
        }
      }
    });
    expect(
      await paddle.paymentMethodsUrl(
        { externalId: 'sub_1', customerId: 'ctm_1' },
        'https://app.example/'
      )
    ).toBe('https://portal/pm');
    expect(calls[0].url).toContain('/customers/ctm_1/portal-sessions');
  });
});

describe('a Paddle subscription', () => {
  it.each([
    ['active', 'active', false],
    ['trialing', 'active', false],
    ['past_due', 'canceled', true],
    ['paused', 'canceled', false],
    ['canceled', 'canceled', false]
  ])('reads %s as %s', (status, expected, paymentFailed) => {
    expect(
      __test.toSubscription(subscription({ status }) as any)
    ).toMatchObject({ status: expected, paymentFailed });
  });

  it('reads a scheduled cancellation, and the user and plan it carries', () => {
    const sub = __test.toSubscription(
      subscription({
        scheduled_change: { action: 'cancel', effective_at: '2026-10-01' }
      }) as any
    );
    expect(sub).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
      userId: 'u1',
      planId: 'pro',
      priceId: 'pri_pro',
      expiresAt: new Date('2026-10-01T00:00:00Z')
    });
  });
});

describe('Paddle webhooks', () => {
  const sign = (body: string, ts = Math.floor(Date.now() / 1000)) =>
    `ts=${ts};h1=${createHmac('sha256', 'pdl_ntfset_secret').update(`${ts}:${body}`).digest('hex')}`;
  const body = JSON.stringify({
    event_id: 'evt_1',
    event_type: 'subscription.updated',
    data: subscription()
  });

  it('are taken when signed with the secret', async () => {
    const event = await paddle.parseWebhook(
      body,
      new Headers({ 'paddle-signature': sign(body) })
    );
    expect(event).toEqual({
      id: 'evt_1',
      type: 'subscription.updated',
      action: {
        kind: 'subscription',
        externalId: 'sub_1',
        hints: { userId: 'u1', planId: 'pro' }
      }
    });
  });

  it('are refused when the body was changed, or the signature is old', async () => {
    await expect(
      paddle.parseWebhook(
        body.replace('sub_1', 'sub_2'),
        new Headers({ 'paddle-signature': sign(body) })
      )
    ).rejects.toThrow('Bad Paddle signature');
    const old = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      paddle.parseWebhook(
        body,
        new Headers({ 'paddle-signature': sign(body, old) })
      )
    ).rejects.toThrow('too old');
  });

  it.each([
    [
      'transaction.completed',
      { id: 'txn_1' },
      { kind: 'payment', externalId: 'txn_1' }
    ],
    [
      'transaction.payment_failed',
      { id: 'txn_2' },
      { kind: 'payment', externalId: 'txn_2' }
    ],
    [
      'adjustment.updated',
      {
        action: 'refund',
        status: 'approved',
        type: 'full',
        transaction_id: 'txn_1',
        currency_code: 'USD',
        totals: { total: '1000' }
      },
      {
        kind: 'refund',
        transactionId: 'txn_1',
        refundAmount: 10
      }
    ],
    [
      'adjustment.created',
      { action: 'refund', status: 'pending_approval', transaction_id: 'txn_1' },
      { kind: 'ignore' }
    ],
    [
      'adjustment.created',
      { action: 'chargeback', status: 'approved', transaction_id: 'txn_1' },
      { kind: 'dispute', transactionId: 'txn_1' }
    ],
    [
      'adjustment.updated',
      {
        id: 'adj_1',
        action: 'refund',
        status: 'rejected',
        transaction_id: 'txn_1'
      },
      { kind: 'refund_failed', transactionId: 'txn_1' }
    ]
  ])('read %s', (type, data, action) => {
    expect(
      __test.actionOf({ event_id: 'e', event_type: type, data } as any)
    ).toEqual(action);
  });
});

describe('Paddle refunds', () => {
  // An upgrade's transaction: the new plan charged, the old one credited.
  const upgrade = {
    id: 'txn_1',
    currency_code: 'USD',
    details: {
      totals: { grand_total: '8000' },
      line_items: [
        { id: 'item_new', totals: { total: '10000' } },
        { id: 'item_old', totals: { total: '-2000' } }
      ]
    }
  };

  it('refund a whole payment as a full adjustment', async () => {
    replies.push({ body: { data: { id: 'adj_1' } } });
    await paddle.refundPayment(
      { externalId: 'txn_1', transactionId: 'txn_1' },
      { cents: 8000, whole: true }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      action: 'refund',
      transaction_id: 'txn_1',
      type: 'full'
    });
  });

  it('refund part of a payment from the lines that charged, past what went back before', async () => {
    replies.push(
      { body: { data: upgrade } },
      {
        body: {
          data: [
            {
              status: 'approved',
              items: [{ item_id: 'item_new', amount: '1000' }]
            },
            {
              status: 'rejected',
              items: [{ item_id: 'item_new', amount: '5000' }]
            }
          ]
        }
      },
      { body: { data: {} } }
    );
    await paddle.refundPayment(
      { externalId: 'txn_1', transactionId: 'txn_1' },
      { cents: 4000, whole: false }
    );
    expect(calls[2].body).toMatchObject({
      type: 'partial',
      items: [{ item_id: 'item_new', type: 'partial', amount: '4000' }]
    });
  });

  it('refuse more than the lines have left', () => {
    expect(() =>
      __test.refundItems(
        upgrade.details.line_items,
        [
          {
            status: 'pending_approval',
            items: [{ item_id: 'item_new', amount: '9000' }]
          } as any
        ],
        2000
      )
    ).toThrow('more than is left');
  });

  it("say in a webhook all refunded of the payment so far, not only this refund's", async () => {
    const body = JSON.stringify({
      event_id: 'evt_r',
      event_type: 'adjustment.updated',
      data: {
        action: 'refund',
        status: 'approved',
        type: 'partial',
        transaction_id: 'txn_1',
        currency_code: 'USD',
        totals: { total: '3000' }
      }
    });
    const ts = Math.floor(Date.now() / 1000);
    const signature = `ts=${ts};h1=${createHmac('sha256', 'pdl_ntfset_secret').update(`${ts}:${body}`).digest('hex')}`;
    replies.push(
      { body: { data: upgrade } },
      {
        body: {
          data: [
            { status: 'approved', type: 'partial', totals: { total: '3000' } },
            { status: 'approved', type: 'partial', totals: { total: '5000' } },
            {
              status: 'pending_approval',
              type: 'partial',
              totals: { total: '100' }
            }
          ]
        }
      }
    );
    const event = await paddle.parseWebhook(
      body,
      new Headers({ 'paddle-signature': signature })
    );
    expect(event.action).toEqual({
      kind: 'refund',
      transactionId: 'txn_1',
      refundAmount: 80
    });
  });
});

describe('a Paddle payment', () => {
  it('says the fee Paddle kept and the tax it collected, in dollars', async () => {
    replies.push({
      body: {
        data: {
          id: 'txn_1',
          status: 'completed',
          subscription_id: 'sub_1',
          customer_id: 'ctm_1',
          currency_code: 'USD',
          details: {
            totals: { grand_total: '1000', tax: '82', fee: '100' },
            line_items: []
          },
          billed_at: '2026-09-28T00:00:00Z',
          created_at: '2026-09-28T00:00:00Z',
          checkout: null
        }
      }
    });
    expect(await paddle.getPayment('txn_1')).toMatchObject({
      amount: 10,
      fee: 1,
      tax: 0.82
    });
  });

  it.each([
    ['api', 'initial'],
    ['web', 'initial'],
    ['subscription_recurring', 'renewal'],
    ['subscription_update', 'upgrade']
  ])('made by %s is a %s payment', async (origin, kind) => {
    replies.push({
      body: {
        data: {
          id: 'txn_1',
          status: 'completed',
          origin,
          subscription_id: 'sub_1',
          customer_id: 'ctm_1',
          currency_code: 'USD',
          details: { totals: { grand_total: '1000' }, line_items: [] },
          billed_at: null,
          created_at: '2026-09-28T00:00:00Z',
          checkout: null
        }
      }
    });
    expect((await paddle.getPayment('txn_1'))?.kind).toBe(kind);
  });
});

describe('the Paddle dashboard', () => {
  it("links a subscription in the sandbox's own dashboard", async () => {
    expect(await paddle.dashboardUrl('sub_1')).toBe(
      'https://sandbox-vendors.paddle.com/subscriptions-v2/sub_1'
    );
  });
});

describe('a Paddle invoice', () => {
  it('is a link Paddle makes when asked', async () => {
    replies.push({ body: { data: { url: 'https://paddle.example/inv.pdf' } } });
    expect(await paddle.invoiceUrl!('txn_1')).toBe(
      'https://paddle.example/inv.pdf'
    );
    expect(calls[0].url).toContain(
      '/transactions/txn_1/invoice?disposition=inline'
    );
  });
});

describe('a Paddle payment method', () => {
  it('is the card that paid the latest transaction', () => {
    expect(
      __test.methodOf({
        payments: [
          { status: 'error', method_details: { type: 'card', card: null } },
          {
            status: 'captured',
            method_details: {
              type: 'card',
              card: {
                type: 'visa',
                last4: '4242',
                expiry_month: 12,
                expiry_year: 2030
              }
            }
          }
        ]
      } as any)
    ).toEqual({
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030
    });
  });

  it('is none without a transaction', () => {
    expect(__test.methodOf(undefined)).toBeNull();
  });
});
