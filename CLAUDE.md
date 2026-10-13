# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The project

A self-hosted AI chatbot that an operator runs for their own users, with their own provider keys. It
supports eight provider types — OpenAI, Azure OpenAI, Google Gemini, Google Vertex AI, Anthropic,
AWS Bedrock, xAI and DeepSeek.

What it supports:

- Streaming chat, with file attachments and per-model system prompts.
- Image generation and editing, video generation and editing, speech synthesis and transcription — all
  as tools the model can call mid-conversation.
- Web search: a chat model with a search of its own uses it; any other asks a designated search model
  through a `web_search` tool. Each search is billed at the model's search rate.
- An artifact panel: code and documents the model produces open beside the conversation, with a live
  sandboxed preview for React, HTML and SVG.
- Conversations that branch, so a message can be regenerated or edited without losing the other reply.
- Share links, a library of generated media, and saved prompts.
- Plans, quotas and per-model pricing, with usage recorded for every generation. Prices are cost
  prices; a tier (the user's own, else the plan's, else the install's default; none is the cost
  price and every model) holds the price multiplier a call is charged at and the models allowed,
  and quotas count what was spent.
- Subscriptions: a plan billed every day, week, month or year, at a price of its own, through the payment processor it names, with the plan set by webhook.
- Several providers behind one model, with automatic failover, and streams that survive a reconnect.

An admin runs the platform from `/console`: which providers exist and with which keys, which models
they expose, what each model costs, and the plans and quotas that decide how much a user may spend.
None of that is configuration — it is all database rows, so a provider is added by an admin at runtime,
not by a deploy.

The two halves are `src/routes/_chat/` for the user app and `src/routes/console/` for the admin console.

## Commands

The package manager is pnpm, and the dev server runs on port 3000.

```bash
pnpm install
pnpm db:migrate        # apply migrations before the first run
pnpm dev               # dev server on :3000

pnpm build
pnpm vercel-build      # drizzle-kit migrate && vite build

pnpm type-check        # tsc --noEmit
pnpm lint              # eslint
pnpm check             # prettier --check (pnpm format writes)
pnpm test              # vitest run
pnpm test:watch

pnpm db:generate       # generate a migration after editing src/db/schema.ts
pnpm db:studio
```

A single test file is `pnpm vitest run src/types/quota.test.ts`, and `-t 'name'` narrows it to one case.

Configuration is a local `.env`, and `.env.example` lists every variable. Four are required:
`DATABASE_URL`, `AUTH_SECRET`, `APP_SECRET` (it encrypts provider keys at rest) and
`BLOB_READ_WRITE_TOKEN`. The rest are optional — `REDIS_URL` turns on resumable streams, and each login
method stays off until enabled. The payment processors' keys (`STRIPE_*`, `PADDLE_*`, `LEMONSQUEEZY_*`) are only keys:
the subscriptions feature is switched by the console setting `subscriptions.enabled`, never an environment variable. Variables the browser reads are prefixed `VITE_` and declared
separately in `src/lib/env.public.ts`, apart from the server schema in `src/lib/env.ts`; today that is
`VITE_UPLOAD_PATH`, the blob prefix uploads are written under, which defaults to `uploads`. A fresh install has no providers, models or quotas, so the first account, which
becomes an admin, has to add them in `/console` before anything can answer — and a
quota is required: a user with no quota of their own, no plan that carries one, and
no default set for the install is refused.

## Stack

- **UI** — React 19, with shadcn/ui components over Radix UI.
- **TanStack Start** — the full-stack React framework the app is built on.
- **TanStack Router** — type-safe routing, with `router-core` underneath it.
- **TanStack Query** — data fetching and caching, joined to the router by
  `@tanstack/react-router-ssr-query` so loader results reach the client cache.
- **TanStack Form** — form state and validation.
- **TanStack Table** — headless tables, used by the console.
- **TanStack Devtools** — the router and devtools panels in development, with `@tanstack/devtools-vite`.
- **Postgres** — the database, reached with the `@neondatabase/serverless` driver.
- **Drizzle ORM** — the TypeScript ORM, with **drizzle-kit** for migrations.
- **Better Auth** — the authentication library.
- **AI SDK** — the AI toolkit for streaming, tool calls, multi-model support and provider adapters.
- **Redis** — used with **resumable-stream** for streams that survive a reconnect.
- **Vercel Blob** — object storage for uploaded and generated media.
- **zod** — schema validation.
- **Vitest** — the test runner; **ESLint** (with `@tanstack/eslint-config`) and **Prettier** for
  linting and formatting.

## Structure

Everything lives under `src/`, and `@/*` maps to `./src/*`.

```
src/
├── router.tsx        router + query client
├── start.ts          Start entry
├── routeTree.gen.ts  generated by the router plugin, not hand-edited
├── routes/           the only path-significant directory
│   ├── _chat.tsx     pathless layout: the app shell and its providers
│   ├── _chat/        chat, library, prompts
│   ├── console.tsx   admin layout, with the admin gate
│   ├── console/      providers, models, pricing, plans, quotas, tiers, users, revenue, usage, logs, settings
│   └── api/          server routes: chat, speech, artifacts, files, auth
├── server/
│   ├── functions/    RPC endpoints
│   ├── services/     the business layer
│   ├── middleware.ts the three auth tiers
│   └── auth.ts, session.ts, public-error.ts
├── db/               schema.ts + migrations/
├── types/            zod schemas and types, client-safe
├── lib/              technical utilities; constant.ts holds the exported constants
├── hooks/, contexts/
├── components/       flat, with only artifacts/, console/ and ui/ grouped
│   └── ui/           shadcn/ui components
└── test-utils/       pg.ts, the PGlite helper
```

## How the project is built

New code should follow the shape the project already has.

**The server is three layers.** `types/` holds the zod input schemas. They are client-safe, so one
schema both validates a server function and drives the form that submits to it.
`services/` is the business layer, and business code reaches the database only from there. `functions/` is the
surface the client calls: it validates, applies auth, and hands off to a service. A domain gets a file in each layer it
needs, usually under the same name, so the three directories run parallel.

**Types and constants.** Types and zod schemas live in `types/`. A constant that is exported for
other files to use lives in `lib/constant.ts`; one that is not exported belongs to its own file and
stays there. A constant is named in capitals with underscores, `BILLING_INTERVALS`, so it is told
from a type (`BillingInterval`) or a function (`billingIntervalOf`) by its name alone.

**Routing is file-based.** `src/routes/` is the only directory where the path on disk becomes a URL.
Pages live there as layouts and routes; `routes/api/` holds the server routes that need to own the
request themselves, such as the chat stream.

**Auth has three tiers**, defined in `server/middleware.ts`: signed-in, admin, and optional. A server
function declares what it needs by picking a tier, rather than checking the session inside the handler,
and the console layout gates the whole admin tree.

**Server code stays on the server.** Modules that must never reach the browser declare it with
`import '@tanstack/react-start/server-only'`, which the build enforces; everything under `services/`
does. `lib/` is for technical utilities used by both sides, and business logic belongs in `services/`.

**Generation is part of the chat stream.** Image, video and speech are tools the model can call during
a conversation, registered in `services/chat-tools.ts`, so a new capability is added there. Web search
is `services/web-search.ts`: it decides per provider whether the model searches for itself or through
the search model, and `lib/chat-usage.ts` counts the searches a step made.

**A plan is the product; payment is taking the money.** A plan is billed at one interval — every
day, week, month or year — through the one payment processor it names, with a price of its own in US
dollars and the processor's price ID — kept on the plan only, and fixed once anyone has subscribed. A
name sold at several intervals is a plan for each (Pro monthly, Pro yearly), and a subscription is
billed at its plan's interval.
`services/subscription.ts` holds the one subscription flow every processor shares: a subscription is
`active` (it renews at `period_end`), `canceled` (it does not renew, and ends at `period_end`) or
`ended`. `period_end` is the only time of the subscription itself; `canceled_at` and `canceled_by`
say when and by whom it was cancelled, `ended_at` when it ended, and `reason` why it was cancelled or
ended. A user has at most one live subscription — `active` or `canceled` — and it gives them its
plan; the only change in place is an upgrade to a dearer plan at the same interval. It reaches a processor only
through the interface in `services/payment-processor.ts`; Stripe, Paddle and Lemon Squeezy are
adapters beside it (`services/payment-*.ts`), and a new processor is another. The flow has three
parts that do not mix. What a user or admin does — buy, upgrade, cancel, resume, refund — is a
business function that decides from the local tables and then calls the processor. What the
processor did is told by webhook at `/api/payments/$processor/webhook`: the adapter hands over the
object the event carries (subscription, payment, refund, dispute); the service checks it against
what is kept — our user, our plan's price, no more refunded than was paid — and writes it as it is,
not put back in the order it happened, with the one action the result calls for (a confirmed refund ends it as the admin
chose, a chargeback ends it, a second subscription bought beside the first is ended and refunded, a
renewal reported failed past the grace days ends it). A subscription event writes the
subscription; its `period_end` moves only when a renewal's payment is reported paid. Nothing in a
request or a webhook reads the processor to decide; the only reads are the checkout the user
comes back from and the scheduled `/api/cron`, which is the separate recovery for
whatever the webhooks did not say: subscriptions past their period end, renewals failed past the grace
days, and refunds sent from here still waiting after a day. Paddle's checkout opens on `/pay/paddle`. A payment keeps the
facts its status is reckoned from — paid, `refund_amount`, `refund_pending` while a refund waits,
`disputed`, and the refund's id — and is kept when its user is deleted; a user's refund request is
a `refund_request` row an admin approves or rejects. Tax is kept two ways: `tax` is what a
processor that sells as the merchant (Paddle, Lemon Squeezy) collected and hands back with a
refund; `seller_tax` is tax that reached the seller with the rest (Stripe, which is not the
merchant), theirs to pay. A refund on auto is reckoned from both alike, since Stripe Tax takes
back the tax on a refund in proportion to it. A Stripe
checkout asks Stripe Tax to work it out whenever Stripe Tax is set up in the account.
Work on one user's subscriptions, or one
payment, runs under `withLock` (`services/db-utils.ts`), since processors send several webhooks
about one thing at once.

Tests sit beside their subject as `foo.ts` and `foo.test.ts`.

## Testing the payment flow

`pnpm test` is the unit tests, against a stand-in processor. A payment flow test is something else:
the running app, driven as a user and an admin would, against a processor's sandbox, with its real
webhooks arriving. When asked to test payments, subscriptions or refunds, that is what is meant — and
it is done without asking the user to sign in or click for you.

**Two dev servers and a tunnel.** A processor cannot call `localhost`, so its webhooks come through a
tunnel to a second dev server:

```bash
pnpm dev                                                   # :3000 — everyday use
cloudflared tunnel --no-autoupdate --url http://localhost:3001   # prints a *.trycloudflare.com address
BETTER_AUTH_URL=<tunnel address> __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.trycloudflare.com \
  pnpm vite dev --port 3001 --strictPort                   # :3001 — the one the processors call
```

Check what is already listening before starting anything; do not start a third. A quick tunnel gets a
new address every time it restarts. Then `:3001` is restarted with it, and each processor is told
through its API:

- **Paddle** — the webhook: `PATCH /notification-settings/{id}` with
  `destination: <tunnel address>/api/payments/paddle/webhook`. And the checkout domain: Paddle opens
  its checkout on the app's own `/pay/paddle`, and refuses a domain it has not approved —
  `POST /checkout-domains` with `{ "domain": "<tunnel host>" }` approves it at once in the sandbox.
- **Lemon Squeezy** — the webhook: `PATCH /v1/webhooks/{id}` with the new `url`.
- **Stripe** — the webhook endpoint: `POST /v1/webhook_endpoints/{id}` with the new `url`; its
  signing secret stays the same. Where there is none yet, `POST /v1/webhook_endpoints` with the `url`
  and `enabled_events[]` — the events the console's payment configuration lists — and `api_version`
  makes one, and answers its `secret` that once only: it goes straight into `.env` as
  `STRIPE_WEBHOOK_SECRET`. The `api_version` is the one the installed `stripe` package is written
  for (`Stripe.API_VERSION`, `2026-08-26.dahlia` today): an endpoint made without it sends its
  events in the account's default version, whose objects an older account may shape otherwise —
  the same goes for one made in Stripe's Dashboard, live or sandbox.

**Which address the browser is driven at** depends on the processor. Paddle's checkout runs on the
app's own page, so for Paddle everything is driven at the tunnel address — sign in there too; its
cookies are `__Secure-` ones and must be set `secure`. Through the tunnel a page takes about half a
minute before React has taken it over: wait for that (a button carrying a `__react…` property)
rather than for a fixed time. Start every run with a fresh browser profile: one kept between runs
came to hold the dev server's modules in a state it never answered, and the page was never taken
over. Lemon Squeezy's checkout is its own hosted page, so for Lemon Squeezy the browser can be
driven at `http://localhost:3000`, which is far quicker.

**Signing in is yours to do.** Test accounts exist, plus-aliases of the owner's address ending
`+claude-test` (an admin), `+claude-test2` and `+claude-test3` (users); find them in the `user`
table. A user with a subscription in effect (`active` or `canceled`) cannot buy another, so pick one without.
More are made as needed: any `+claude-testN` alias, signed in as below, becomes a user the first time.
Flows run side by side each need an account of their own, and a refund that only cancels leaves its
account unable to buy until the period ends — take a new alias rather than wait. For any of them:

1. `POST /api/auth/email-otp/send-verification-otp` with `{ email, type: 'sign-in' }` and an `Origin`
   header of the address being driven.
2. Read the code from the `verification` table — the row whose `identifier` is
   `sign-in-otp-<email>`; its `value` is `<code>:<attempts>`. Use `Pool` from
   `@neondatabase/serverless` with `DATABASE_URL`, as the app does.
3. `POST /api/auth/sign-in/email-otp` with `{ email, otp }`, and put the cookies it sets into the
   browser.

**Driving it is yours to do.** Install `puppeteer` in the session's scratchpad directory, never in
the project, and write the scripts there: one small library — sign in, open a page with the cookies
set, click by visible text, read the toasts and dialogs — and one script per flow. Launch the
headless shell (`headless: 'shell'`), not the full headless browser: that one stops drawing once the
machine has sat idle a while, and a wait for a frame, a click or a screenshot then never finishes.
The plans dialog opens from the Upgrade pill for a user with no subscription, and from Settings →
Billing → Upgrade plan for one who has. Its choice of interval shows only once the plans have arrived, and a press
made before then is lost: check that the interval wanted is the one pressed, and the card's price,
before pressing Subscribe — otherwise another plan is bought. Pay with the sandbox test card
`4242 4242 4242 4242`:

- **Paddle** — an overlay in a frame from `sandbox-buy.paddle.com/checkout`: the postcode first, then
  `#cardNumber`, `#cardHolder`, `#expiry`, `#cvv`. It speaks the browser's language — Chinese here —
  so find its buttons by what they do, not by their words: Continue after the postcode, then the
  subscribe button, not the PayPal one beside it.
- **Lemon Squeezy** — its hosted page, with the card fields inside a Stripe iframe. Type the card,
  its expiry and code, and the address at a person's pace, about 150 ms a key: typed faster, its
  hCaptcha check holds the payment back, and Pay does nothing, with no error. Send
  `Accept-Language: en-US`, or the page comes in another language. Paid, it shows a thank-you whose
  Continue goes back to the app; the button appears a second or two after the page, so wait for it.
  Its invoice can stay pending for a minute after that, and the payment is kept only once it is paid:
  wait for the `payment` row rather than assume it. It keeps one cart per browser session: a second
  checkout opened in the same browser replaces the first.

After each step print the `subscription`, `payment` and `refund_request` rows and what the processor
itself says of the subscription, then again once the webhooks have come. A purchase or a cancel
arrives within seconds; a refund in Paddle's sandbox is approved only by a job that runs about every
ten minutes, so wait for the payment to leave `refund_pending` rather than for a fixed time. The
sandbox never rejects a refund and cannot make a real chargeback: those paths have only unit tests.

**What a processor does by itself** — the steps that are not the app's — is done through its API:

- **Paddle** — a refund: `POST /adjustments` with `action: 'refund'`, the `transaction_id`, a `reason`,
  and `type: 'full'`, or `type: 'partial'` with `items: [{ item_id, type: 'partial', amount }]` — the
  item from the transaction's `details.line_items`, the amount in cents. A pause, a resume, or an end
  at once: `POST /subscriptions/{id}/pause`, `…/resume` or `…/cancel` with
  `effective_from: 'immediately'`.
- **Lemon Squeezy** — a refund: `POST /v1/subscription-invoices/{id}/refund` with `amount` in cents;
  the invoice is the payment's `external_id`.

**A renewal that fails** is made for real in Paddle: give the subscription a card that is accepted
but whose charges fail, `4000 0000 0000 0341`, then bring its renewal forward. The card is changed
through `GET /subscriptions/{id}/update-payment-method-transaction`: open its transaction on the
app's `/pay/paddle?_ptxn=<id>` — a page with no buttons of its own, so wait for Paddle's frame, not
for React — and pay it there. Then `PATCH /subscriptions/{id}` with `next_billed_at` at least half an
hour ahead and `proration_billing_mode: 'do_not_bill'`; at that time Paddle charges, the charge fails,
and the app has a failed renewal, a subscription still in effect, and Billing saying the payment
failed. Paddle's simulations (`POST /simulations`) are no stand-in: a renewal they send reuses the
subscription's first transaction and its period, so it never reads as the next period unpaid.

**The daily job** at `/api/cron` is off without `CRON_SECRET`. To run it once without
touching `.env` or the running servers, start a short-lived server with the secret given inline
(`CRON_SECRET=… pnpm vite dev --port 3003 --strictPort`), call it with
`Authorization: Bearer <secret>`, and stop that server again. What it recovers is what a webhook did
not say, so each path is made by keeping the webhook away: point Paddle's notification setting at a
path the app does not answer, act in the processor, then set back the time the job looks at, and run
it. A subscription past its period end: end it in Paddle, set its `period_end` two days back — the
job asks Paddle and ends it. A refund still waiting: refund from the console, wait until Paddle
approves it, set the payment's `refund_at` a day and an hour back — the job asks Paddle for the
refund. A renewal unpaid past the grace days: after a renewal that fails (above), set `period_end`
back past the grace days — the job ends it without asking, and in Paddle too. Point the setting back
afterwards; Paddle sends the failed notifications again later, and they change nothing.

**Before the first purchase.** The plans under test must exist in `/console/plans`, each with its
processor and that processor's price ID, and be enabled; `subscriptions.enabled` must be on, and
`refunds.enabled` for refund requests. A processor's prices must be in US dollars. Which processors
can be tested is which have keys in `.env`. A daily or weekly price is made in Paddle's sandbox
through its API — `POST /prices` with `billing_cycle: { interval: 'week', frequency: 1 }` and
`quantity: { minimum: 1, maximum: 1 }`; Lemon Squeezy's API cannot make a variant, so one there is
made in its dashboard.

**What to walk through**, checking after each step the rows, the user's plan, and that the
processor's side agrees:

1. Subscribe: plans dialog → checkout → back in the app with the plan.
2. Cancel, then Resubscribe — only what the user cancelled themselves can be resumed.
3. Upgrade to a dearer plan (Stripe, Paddle): the dialog shows the charge first.
4. An admin cancels: the user has no Resubscribe.
5. The user asks for a refund; an admin approves it, ending the subscription or cancelling it, or rejects
   it. The subscription is only canceled until the processor confirms the money went back; a refund the
   processor rejects puts it back, and the request waits to be decided again.
6. An admin refunds a payment from Payments, ending the subscription or cancelling it.
7. A second subscription bought beside the first: ended, and refunded in full. Open both
   checkouts through the app before paying either, and keep their addresses; then pay each in the
   tab in front, since a tab behind it is held back and Paddle's overlay never finishes there — and,
   for Lemon Squeezy, each in a browser of its own, since a second cart replaces the first.
8. A refund made in the processor's own dashboard ends the subscription too; one of only part of the
   payment cancels it, and the plan stays until the period end.
9. A dispute, where the sandbox can make one.
10. Paused in the processor: ended, the plan gone; resumed there: in effect again, with the period
    the processor charged for.
11. A renewal that fails: still in effect, the user told to update how they pay, and no upgrade;
    unpaid past the grace days, ended, and ended in the processor.
12. A canceled subscription reaching its period end, and one renewing: Paddle's daily plan gives
    both a day later — ended at `period_end`, or a renewal paid and `period_end` a day on.
13. The daily job's three recoveries, as above.

Say plainly which steps were run and which could not be, and why.
