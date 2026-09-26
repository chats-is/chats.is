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

## The admin console

Everything an operator manages lives at `/console`:

| Page           | What it does                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| Overview       | Counts, plus spend, tokens and requests over a date range, by model, provider and capability |
| Providers      | Provider accounts and their keys (encrypted at rest)                                         |
| Models         | The models users can pick, the providers behind each, and their options                      |
| Pricing        | Per-model rates: tokens, images, video seconds, characters, audio seconds                    |
| Plans / Quotas | Spending limits, assigned by plan, per user, or as the install's default                     |
| Tiers          | A price multiplier over the cost price and the models allowed, chosen by a plan or a user    |
| Usage          | Every call, opening onto what it was billed for, item by item                                |
| Users          | Accounts, roles, and each user's limits, spend and log                                       |
| Settings       | Title generation, speech, web search, and other install-wide options                         |

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
