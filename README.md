# chats.is

A self-hosted AI chat app. You run it for your own users, with your own
provider keys, and decide in an admin console which models they can use and how
much they may spend.

## Features

- **Eight provider types** — OpenAI, Azure OpenAI, Google Gemini, Google Vertex
  AI, Anthropic, AWS Bedrock, xAI and DeepSeek. Providers, their keys and the
  models they serve are added at runtime from the console, not by a deploy.
- **Streaming chat** with file attachments, per-model system prompts and
  reasoning effort.
- **Image, video and speech** — generation, editing, text-to-speech and
  transcription, as tools the model calls in the middle of a conversation.
- **Web search** — a model with a search of its own uses it; any other asks
  a designated search model. Billed per search, and the user can switch it
  off per message.
- **Artifacts** — code and documents open beside the conversation, with a live
  sandboxed preview for React, HTML and SVG.
- **Branching conversations** — regenerate or edit a message without losing
  the other reply.
- **Share links**, a **library** of generated media, and **saved prompts**.
- **Failover** — several providers behind one model, tried in turn, and a model
  id can be routed to the id a provider knows it by.
- **Resumable streams** — a reply keeps streaming through a reload or a dropped
  connection (with Redis).
- **Billing** — per-model cost prices; tiers, each a price multiplier over
  the cost price and the models allowed, that a plan or a user is put on;
  plans and quotas with 5-hour and weekly limits; and every call recorded
  with what it cost and what the user spent.
- **Subscriptions** — plans sold monthly or yearly through a payment processor
  (Stripe today), switched and cancelled in the app, with every payment kept.

## The admin console

Everything an operator manages lives at `/console`:

| Page           | What it does                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Overview       | Counts, plus spend, tokens and requests over a date range, by model, provider and capability      |
| Providers      | Provider accounts and their keys (encrypted at rest)                                              |
| Models         | The models users can pick, the providers behind each, and their options                           |
| Pricing        | Per-model rates: tokens, images, video seconds, characters, audio seconds                         |
| Plans / Quotas | Spending limits, assigned by plan, per user, or as the install's default                          |
| Tiers          | A price multiplier over the cost price and the models allowed, chosen by a plan or a user         |
| Subscriptions  | Every subscription by status, processor or user; each opens onto its payments and refund requests |
| Payments       | Every payment: what it was for, the processor's fee and tax, what was refunded, the invoice       |
| Usage          | Every call, opening onto what it was billed for, item by item                                     |
| Users          | Accounts, roles, and each user's limits, spend and log                                            |
| Settings       | Title generation, speech, web search, and other install-wide options                              |

## Stack

[TanStack Start](https://tanstack.com/start) (React 19, Router, Query, Form,
Table) · [AI SDK](https://ai-sdk.dev) · Postgres with
[Drizzle](https://orm.drizzle.team) · [Better Auth](https://better-auth.com) ·
Vercel Blob · Redis with `resumable-stream` · shadcn/ui and Tailwind ·
Vitest.

## Getting started

Requires Node.js 22.9 or later, pnpm, and a Postgres database.

```bash
pnpm install
cp .env.example .env    # then fill it in — see below
pnpm db:migrate
pnpm dev                # http://localhost:3000
```

### Environment

`.env.example` lists every variable. These are required:

| Variable                |                                                            |
| ----------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`          | Postgres connection string (`postgres://…`)                |
| `AUTH_SECRET`           | Session secret — `openssl rand -base64 32`                 |
| `APP_SECRET`            | Encrypts provider keys at rest — `openssl rand -base64 32` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token, for uploads and generated media         |

At least one login method must be turned on, or no one can sign in:

| Method              | Variables                                                          |
| ------------------- | ------------------------------------------------------------------ |
| Email one-time code | `AUTH_EMAIL_ENABLED=true`, `RESEND_API_KEY`, `EMAIL_FROM`          |
| GitHub              | `AUTH_GITHUB_ENABLED=true`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` |
| Google              | `AUTH_GOOGLE_ENABLED=true`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |

OAuth callbacks are `{BETTER_AUTH_URL}/api/auth/callback/github` and
`…/google`; set `BETTER_AUTH_URL` to the origin the app is served from.

Optional: `REDIS_URL` turns on resumable streams (use a low-latency Redis —
Upstash's pub/sub round-trip is too slow for it), `VITE_UPLOAD_PATH` sets the
blob prefix for uploads (default `uploads`), and `UMAMI_SCRIPT_URL` /
`UMAMI_WEBSITE_ID` add analytics.

### Selling plans

A plan is the product: its quota and tier, and a price of its own in US
dollars, billed monthly or yearly. It is sold through one payment processor,
chosen on the plan, and names the price that processor knows it by. Stripe,
Paddle and Lemon Squeezy are supported; each needs only its keys set, and a
plan sold through it.

| Processor     | Keys                                                                           | Webhook                              | The plan's ID          |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------ | ---------------------- |
| Stripe        | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                   | `/api/payments/stripe/webhook`       | A recurring price      |
| Paddle        | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_CLIENT_TOKEN`               | `/api/payments/paddle/webhook`       | A recurring price      |
| Lemon Squeezy | `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_STORE_ID` | `/api/payments/lemonsqueezy/webhook` | A subscription variant |

Webhook addresses are under `{BETTER_AUTH_URL}`. The events to send:

- **Stripe:** `checkout.session.completed`, `customer.subscription.created`,
  `.updated`, `.deleted`, `.paused` and `.resumed`, `invoice.paid`,
  `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.
- **Paddle:** every `subscription.*` event, `transaction.completed`,
  `transaction.payment_failed`, `adjustment.created`, `adjustment.updated`.
  Set the default payment link to `{BETTER_AUTH_URL}/pay/paddle` — the page
  that opens Paddle's checkout — and approve its domain.
- **Lemon Squeezy:** every `subscription_*` event, including
  `subscription_payment_success`, `_failed`, `_recovered` and `_refunded`.

Then:

1. Create recurring prices in US dollars in the processor, each with a
   maximum quantity of 1. In `/console/plans`, make a plan, choose its
   billing — Monthly, Yearly or Monthly and Yearly — and its payment
   processor, and give each interval its price and that price's ID. **Sync
   price** reads the amount from the processor. Before anything is charged,
   the plan and the processor's price must agree.
2. Enable the plan in the table: only enabled plans are offered.
3. Turn on **Enable Subscriptions** in `/console/settings`. When it is off,
   subscriptions already bought keep running and can still be cancelled.

Once anyone has subscribed to a plan, its billing, prices, payment processor and
price IDs are fixed and the plan cannot be deleted; its quota, tier, name and
description can still change. Disabling a plan stops new subscriptions, and
those already on it keep renewing.

The subscription flow is the same whichever processor a plan is sold through:

- A user subscribes to a plan at the interval they choose, and has one active
  subscription at a time. Their plan is its plan while it is active.
- The only change made in place is an upgrade: to a plan that costs more, at
  the same interval, through the same processor. It starts now and charges
  the difference.
- A cheaper plan, another interval or a plan at the same price is a new
  subscription: cancel, and subscribe again once the current one is canceled.
- Cancelling keeps the subscription active until the end of what was paid
  for — "Your subscription will be canceled on …" — and can be taken back
  until then. Then it is canceled.
- A failed payment, a dispute, an approved refund or an admin cancelling it
  from a payment cancels the subscription at once, in the app even where the
  processor can only cancel it with the period. Why it was canceled is kept.
- Refunds, set under Settings with a switch of their own: a user asks for a
  refund of their subscription — no amount, a reason if they like — and an
  admin approves it, choosing how much of each payment made within the
  refund window goes back and cancelling the subscription, or rejects it.
  The request dialog shows the rules and an estimate. The Refund Fee is what
  a refund keeps back: Auto (the default) the fee the processor charged on
  the payment — or nothing where the processor does not say its fee, as
  Lemon Squeezy does not; or a percentage of what was paid. Refund Requests
  limits how many a subscription can have. An admin can also refund any
  payment from Payments or a subscription's details, and choose whether the
  subscription is canceled; refunding all that is left always cancels it.
- A payment shows what was refunded of it, and Refund pending until the
  processor confirms a refund (Paddle has each approved). One made in the
  processor's own dashboard is kept too. No second refund of a payment is
  sent while one is pending.
- A user with an active subscription cannot be deleted. Their payments are
  kept when they are, with the email they paid under.

### First run

A fresh install has no providers, models or quotas, so nothing can answer yet.

1. Sign in. The first account on an empty install becomes the admin.
2. In `/console`, add a **provider** with its key, then the **models** it
   serves, and give each model a **price**.
3. Create a **quota** and make it the default (or give users one through a
   plan). A user with no quota of their own, no plan that carries one, and no
   default is refused — there is no "unlimited unless configured".

## Deploying

### Vercel

The repo is set up for Vercel (`vercel.json` names the framework). Vercel runs
`pnpm vercel-build`, which applies migrations and then builds — so
`DATABASE_URL` must be available at build time and reachable from Vercel's
build machines. Set the environment variables above in the project settings.

The whole app is served by one Node.js 22 function with response streaming and
a 300-second limit, set in `nitro.config.ts`, so long generations are not cut
off. That limit needs a paid plan; on Hobby the platform's lower ceiling
applies.

### Anywhere else

```bash
pnpm db:migrate
pnpm build
pnpm start              # serves .output/server/index.mjs, reading .env
```

The build is a standalone Node server (Nitro); put it behind any reverse
proxy. Public assets are pre-compressed with gzip and brotli.

## Development

```bash
pnpm dev            # dev server on :3000
pnpm type-check     # tsc --noEmit
pnpm lint           # eslint
pnpm check          # prettier --check  (pnpm format writes)
pnpm test           # vitest run
pnpm db:generate    # a migration, after editing src/db/schema.ts
pnpm db:studio      # browse the database
```

One test file: `pnpm vitest run src/types/quota.test.ts`, narrowed with
`-t 'name'`.

### Layout

```
src/
├── routes/          file-based routes — the only directory whose paths are URLs
│   ├── _chat/       the user app: chat, library, prompts
│   ├── console/     the admin console
│   └── api/         server routes that own the request: chat stream, speech, files, auth
├── server/
│   ├── functions/   RPC endpoints the client calls — validate, authorize, delegate
│   ├── services/    business logic; the only layer that touches the database
│   └── middleware.ts  the three auth tiers: signed-in, admin, optional
├── types/           zod schemas shared by server functions and forms
├── db/              schema.ts and migrations
├── lib/             technical utilities used on both sides
└── components/      UI; shadcn/ui primitives in components/ui
```

A domain usually has a file in each of `types/`, `services/` and `functions/`
under the same name. Image, video and speech generation are chat tools,
registered in `server/services/chat-tools.ts`; web search is set up in
`server/services/web-search.ts`. Tests sit beside their subject as
`foo.test.ts`.

## License

Copyright (C) 2026 John.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, version 3. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; see [LICENSE](LICENSE) for the full text.

Running a modified version as a service for others counts as distribution
under the AGPL: the modified source must be offered to those users.
