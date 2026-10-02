import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Lemon Squeezy adapter against a stand-in for its API: what it sends,
 * and how it reads what comes back and what its webhooks say.
 */

vi.mock('@/lib/env', () => ({
  env: {
    LEMONSQUEEZY_API_KEY: 'ls_test_key',
    LEMONSQUEEZY_WEBHOOK_SECRET: 'ls_secret',
    LEMONSQUEEZY_STORE_ID: '42'
  }
}));

const { createLemonSqueezyProcessor, __test } =
  await import('./payment-lemonsqueezy');

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

const lemon = createLemonSqueezyProcessor();
const path = (c: Call) => c.url.replace('https://api.lemonsqueezy.com/v1', '');

const subscription = (attributes: Record<string, unknown> = {}) => ({
  type: 'subscriptions',
  id: '77',
  attributes: {
    store_id: 42,
    customer_id: 9,
    variant_id: 555,
    status: 'active',
    cancelled: false,
    renews_at: '2026-10-01T00:00:00.000000Z',
    ends_at: null,
    updated_at: '2026-09-01T00:00:00.000000Z',
    urls: {
      update_payment_method: 'https://store/pm',
      customer_portal: 'https://store/portal'
    },
    ...attributes
  }
});

describe('the Lemon Squeezy API', () => {
  it('reads a variant’s price model in the store’s currency', async () => {
    replies.push(
      {
        body: {
          data: {
            type: 'variants',
            id: '555',
            attributes: { status: 'published', product_id: 7 }
          }
        }
      },
      {
        body: {
          data: {
            type: 'prices',
            id: '1',
            attributes: {
              category: 'subscription',
              unit_price: 1999,
              renewal_interval_unit: 'month',
              renewal_interval_quantity: 1,
              usage_aggregation: null
            }
          }
        }
      },
      {
        body: {
          data: { type: 'stores', id: '42', attributes: { currency: 'USD' } }
        }
      },
      {
        body: {
          data: {
            type: 'products',
            id: '7',
            attributes: { status: 'published' }
          }
        }
      }
    );
    expect(await lemon.getPrice('555')).toEqual({
      priceId: '555',
      amount: 19.99,
      currency: 'usd',
      interval: 'month',
      active: true,
      metered: false,
      maxQuantity: null
    });
    expect(calls.map(path)).toEqual([
      '/variants/555',
      '/variants/555/price-model',
      '/stores/42',
      '/products/7'
    ]);
  });

  it('sells a published product’s default variant, which stays pending', async () => {
    const variant = () => ({
      body: {
        data: {
          type: 'variants',
          id: '556',
          attributes: { status: 'pending', product_id: 8 }
        }
      }
    });
    const rest = (productStatus: string) => [
      {
        body: {
          data: {
            type: 'prices',
            id: '2',
            attributes: {
              category: 'subscription',
              unit_price: 1000,
              renewal_interval_unit: 'month',
              renewal_interval_quantity: 1,
              usage_aggregation: null
            }
          }
        }
      },
      {
        body: {
          data: { type: 'stores', id: '42', attributes: { currency: 'USD' } }
        }
      },
      {
        body: {
          data: {
            type: 'products',
            id: '8',
            attributes: { status: productStatus }
          }
        }
      }
    ];
    replies.push(variant(), ...rest('published'));
    expect((await lemon.getPrice('556')).active).toBe(true);
    replies.push(variant(), ...rest('draft'));
    expect((await lemon.getPrice('556')).active).toBe(false);
  });

  it('reads a one-off price as no interval it can sell', async () => {
    replies.push(
      {
        body: {
          data: {
            type: 'variants',
            id: '1',
            attributes: { status: 'published' }
          }
        }
      },
      {
        body: {
          data: {
            type: 'prices',
            id: '1',
            attributes: { category: 'one_time', unit_price: 500 }
          }
        }
      },
      {
        body: {
          data: { type: 'stores', id: '42', attributes: { currency: 'USD' } }
        }
      }
    );
    expect((await lemon.getPrice('1')).interval).toBeNull();
  });

  it('opens a checkout for the variant, carrying the user and plan', async () => {
    replies.push({
      body: {
        data: {
          type: 'checkouts',
          id: 'c1',
          attributes: {
            url: 'https://store.lemonsqueezy.com/checkout/custom/c1'
          }
        }
      }
    });
    const url = await lemon.createCheckout({
      customerId: null,
      email: 'u1@test.com',
      priceId: '555',
      userId: 'u1',
      planId: 'pro',
      origin: 'https://app.example',
      successUrl: 'https://app.example/?checkout=success',
      cancelUrl: 'https://app.example/?checkout=canceled'
    });
    expect(url).toBe('https://store.lemonsqueezy.com/checkout/custom/c1');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: {
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: 'u1@test.com',
              custom: { user_id: 'u1', plan_id: 'pro' }
            },
            product_options: {
              redirect_url: 'https://app.example/?checkout=success'
            }
          },
          relationships: {
            store: { data: { type: 'stores', id: '42' } },
            variant: { data: { type: 'variants', id: '555' } }
          }
        }
      }
    });
  });

  it('does not upgrade in place, and asks Lemon Squeezy nothing', async () => {
    await expect(
      lemon.changeNow('77', { priceId: '600', planId: 'max' })
    ).rejects.toThrow('cannot be switched in place');
    expect(calls).toEqual([]);
  });

  it('cancels, resumes, and leaves an already cancelled one alone', async () => {
    await lemon.cancelAtPeriodEnd('77');
    await lemon.resume('77');
    replies.push({
      body: { data: subscription({ cancelled: true, status: 'cancelled' }) }
    });
    await lemon.cancelNow('77');
    expect(calls.map(c => [c.method, path(c)])).toEqual([
      ['DELETE', '/subscriptions/77'],
      ['PATCH', '/subscriptions/77'],
      ['GET', '/subscriptions/77']
    ]);
  });

  it('reads an invoice as a payment in dollars, with its tax', async () => {
    replies.push({
      body: {
        data: {
          type: 'subscription-invoices',
          id: '31',
          attributes: {
            subscription_id: 77,
            customer_id: 9,
            status: 'paid',
            total: 1999,
            tax: 150,
            currency: 'USD',
            created_at: '2026-09-01T00:00:00Z',
            urls: { invoice_url: 'https://store/invoice/31' }
          }
        }
      }
    });
    expect(await lemon.getPayment('31')).toMatchObject({
      externalId: '31',
      transactionId: '31',
      subscriptionExternalId: '77',
      customerId: '9',
      amount: 19.99,
      fee: null,
      tax: 1.5,
      paid: true,
      invoiceUrl: 'https://store/invoice/31'
    });
  });

  it('sends the user to the subscription’s own payment method page', async () => {
    replies.push({ body: { data: subscription() } });
    expect(
      await lemon.paymentMethodsUrl(
        { externalId: '77', customerId: '5' },
        'https://app.example/'
      )
    ).toBe('https://store/pm');
  });
});

describe('a Lemon Squeezy subscription', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it.each([
    ['active', {}, 'active', false, false],
    ['on_trial', {}, 'active', false, false],
    ['past_due', {}, 'canceled', false, true],
    ['unpaid', {}, 'canceled', false, true],
    ['paused', {}, 'canceled', false, false],
    ['expired', {}, 'canceled', false, false],
    [
      'cancelled, running to its end',
      { cancelled: true, ends_at: future },
      'active',
      true,
      false
    ],
    [
      'cancelled, and ended',
      { cancelled: true, ends_at: past },
      'canceled',
      false,
      false
    ]
  ])(
    'reads %s',
    (status, extra, expected, cancelAtPeriodEnd, paymentFailed) => {
      const sub = __test.toSubscription(
        subscription({ status: status.split(',')[0], ...extra }) as any
      );
      expect(sub).toMatchObject({
        status: expected,
        cancelAtPeriodEnd,
        paymentFailed
      });
    }
  );

  it('reads a cancellation as coming when what was paid for runs out', () => {
    const sub = __test.toSubscription(
      subscription({
        status: 'cancelled',
        cancelled: true,
        ends_at: future
      }) as any
    );
    expect(sub).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
      expiresAt: new Date(future),
      priceId: '555',
      customerId: '9',
      userId: null
    });
  });
});

describe('Lemon Squeezy webhooks', () => {
  const event = {
    meta: {
      event_name: 'subscription_created',
      custom_data: { user_id: 'u1', plan_id: 'pro' }
    },
    data: subscription()
  };
  const body = JSON.stringify(event);
  const sign = (b: string) =>
    createHmac('sha256', 'ls_secret').update(b).digest('hex');

  it('are taken when signed, naming the user and plan', async () => {
    expect(
      await lemon.parseWebhook(body, new Headers({ 'x-signature': sign(body) }))
    ).toEqual({
      id: 'subscription_created:77:2026-09-01T00:00:00.000000Z',
      type: 'subscription_created',
      action: {
        kind: 'subscription',
        externalId: '77',
        hints: { userId: 'u1', planId: 'pro' }
      }
    });
  });

  it('are refused when the body was changed', async () => {
    await expect(
      lemon.parseWebhook(
        body.replace('"77"', '"78"'),
        new Headers({ 'x-signature': sign(body) })
      )
    ).rejects.toThrow('Bad Lemon Squeezy signature');
  });

  it.each([
    ['subscription_payment_success', { kind: 'payment', externalId: '31' }],
    ['subscription_payment_failed', { kind: 'payment', externalId: '31' }],
    ['order_created', { kind: 'ignore' }]
  ])('read %s', (name, action) => {
    expect(
      __test.actionOf({
        meta: { event_name: name },
        data: { type: 'subscription-invoices', id: '31', attributes: {} }
      } as any)
    ).toEqual(action);
  });

  it('read a refund of an invoice, in dollars', () => {
    expect(
      __test.actionOf({
        meta: { event_name: 'subscription_payment_refunded' },
        data: {
          type: 'subscription-invoices',
          id: '31',
          attributes: {
            refunded_amount: 500,
            currency: 'USD',
            refunded: false,
            status: 'partial_refund'
          }
        }
      } as any)
    ).toEqual({
      kind: 'refund',
      transactionId: '31',
      refundAmount: 5
    });
  });
});

describe('a Lemon Squeezy payment method', () => {
  it('is the card on the subscription, without an expiry', () => {
    expect(
      __test.methodOf(
        subscription({ card_brand: 'visa', card_last_four: '4242' }) as any
      )
    ).toEqual({
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: null,
      expYear: null
    });
  });

  it('is PayPal where it was paid through PayPal', () => {
    expect(
      __test.methodOf(subscription({ payment_processor: 'paypal' }) as any)
    ).toMatchObject({ type: 'paypal', last4: null });
  });
});
