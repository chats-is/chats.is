# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`chats.is` — a multi-provider AI chatbot (Next.js App Router + React 19) that does chat, image, video, and audio/speech generation. It's an admin-configurable platform: providers, models, prompts, plans, pricing, and quotas all live in the database and are managed through a `/console` admin UI rather than hardcoded. Package manager is **pnpm**.

## Tech stack

- **Framework**: Next.js 16 (App Router, RSC, Turbopack), React 19, TypeScript (strict).
- **AI**: Vercel AI SDK v6 (`ai`, `@ai-sdk/*`) across OpenAI / Azure / Google / Vertex / Anthropic / Bedrock / xAI / DeepSeek.
- **API layer**: tRPC v11 + TanStack React Query; `superjson` transformer.
- **Database**: Postgres via Neon serverless driver, Drizzle ORM + drizzle-kit migrations.
- **Auth**: NextAuth v5 (beta) with Drizzle adapter, JWT sessions; Resend for email-code login.
- **Storage**: Vercel Blob for generated/uploaded media.
- **UI**: Tailwind CSS v4 (config-less), shadcn/ui (new-york) over Radix primitives, lucide + `@lobehub/icons`, framer-motion, sonner (toasts), CodeMirror (artifact code editing), react-markdown + remark-gfm.
- **Forms/validation**: react-hook-form + zod (zod also validates env and message-part schemas).
- **Tooling**: ESLint (flat config) + Prettier (with import-sort & tailwind plugins), Vitest (node env), `@t3-oss/env-nextjs` for env validation.

## Commands

```bash
pnpm dev                 # dev server (Next 16 / Turbopack)
pnpm build               # production build
pnpm vercel-build        # drizzle migrate + build (deploy)
pnpm lint                # eslint
pnpm type-check          # tsc --noEmit  (run this to verify type changes)
pnpm test                # vitest run (all tests)
pnpm test:watch          # vitest watch
pnpm format:write        # prettier write
pnpm db:generate         # generate migration from schema.ts changes
pnpm db:migrate          # apply migrations
pnpm db:studio           # drizzle studio
```

Run a single test: `pnpm vitest run lib/pricing.test.ts` (or `-t "name"` to filter).

Tests are **Node-environment unit tests** (vitest.config.ts), currently all in `lib/**` (billing/quota/usage/pricing logic), no DOM — coverage is *configured* for `lib/**` and `server/**`, but no `server/` tests exist yet. `server-only` is stubbed and `@electric-sql/pglite` is available for DB-backed tests (see `billing.integration.test.ts`). There are no component/E2E tests.

## Architecture

### Request → response is split by modality
- **Chat is streaming.** `app/api/chat/route.ts` (~800 lines, the heart of the app) uses Vercel AI SDK v6: `streamText` wrapped in `createUIMessageStream` → `createUIMessageStreamResponse`. It also defines the `create_artifact` tool inline and streams artifact deltas as custom data parts.
- **Image / video / audio are non-streaming and happen inside the chat request.** They are no longer standalone routes: `lib/chat-tools.ts` registers `generate_image` / `edit_image` / `generate_video` / `text_to_speech` / `transcribe_audio` as AI SDK tools on the chat stream. Each follows one shape: generate → upload bytes to **Vercel Blob** (`@vercel/blob` `put`) → return a `MediaToolOutput` that `components/media-tool-part.tsx` renders inline. The old `/image`, `/video`, `/audio` pages redirect to `/chat` (see `next.config.ts`). Speech (TTS playback of a message) is the one surviving standalone route, `app/api/speech/route.ts`.

Every generation path follows the same lifecycle: `auth()` → look up model/provider → **`preflightGate()`** / `preflightCheck()` (pricing exists + model allowed + quota not exceeded; returns 403/429 or a structured tool error) → generate → persist message(s) → **`recordXUsage()`**. Quota is checked *before* generation and consumed *after* (next request sees the new balance).

**Generation deadlines.** Vercel caps a function at 300s (`maxDuration` in `app/api/chat/route.ts`; 300 is also the hard ceiling on the Hobby plan, where larger values are silently capped). A render that outlives the function gets the request killed mid-stream, which skips `onFinish` — the assistant message is never persisted and no usage row is written, while the provider bills anyway. So video generation imposes its own `VIDEO_DEADLINE_MS` (`lib/video-generation.ts`) well inside that budget, on both the Sora polling path and the AI SDK path, and raises `VideoTimeoutError`. That error deliberately does **not** trigger provider failover: the deadline is ours and applies to every provider, so retrying just restarts the render and spends the remaining budget.

### Provider abstraction (`lib/provider.ts`)
All eight provider types (`openai`, `azure`, `google`, `vertex`, `anthropic`, `bedrock`, `xai`, `deepseek`) are unified behind `createProviderSDK(config)` → `getLanguageModel` / `getImageModel` / `getVideoModel` / `getSpeechModel`. **Config comes from the DB `providers` table, never env vars.** API keys are stored AES-encrypted (`lib/crypto.ts`) and `decrypt()`-ed at call time. `vertex` and `bedrock` pack their credentials as JSON in the `apiKey` field; their model IDs are remapped via `VertexAIModels` / `BedrockModels` in `lib/constant.ts`.

### Data model (`server/db/schema.ts`, Drizzle + Postgres via Neon serverless)
- DB driver is fixed to `@neondatabase/serverless` Pool + `drizzle-orm/neon-serverless` (`server/db/index.ts`). Schema changes → `pnpm db:generate` → migration in `server/db/migrations/`.
- **Messages**: `message.parts` is a JSONB column typed as `ChatMessage['parts']`. `ChatMessage = UIMessage<MessageMetadata, CustomUIDataTypes>` (extends the AI SDK `UIMessage`). Part schemas live in `types/content-part.ts` (text / reasoning / file / tool / source / data…). `message.parentId` is a self-FK enabling regenerate/branch threading.
- **Models & providers**: a `model` has a `capability` (chat/image/video/audio) plus two JSONB blobs — `uiOptions` (sizes/aspectRatios/resolutions/durations/voices used to drive the UI selectors) and `apiParams` (temperature/topP/…). Models belong to a `provider`.
- **Billing** is four cooperating tables. A user's effective limit resolves: `user.quotaId` → `user.planId → plan.quotaId` → system default quota → unlimited. `quota` holds `fiveHour`/`sevenDay` cost windows + `allowedModelIds` whitelist. `modelPricing` is one row per model with per-unit rates for every billing dimension, plus a `source` (`manual` / `models.dev` / `llm-metadata`). Rates can be entered manually or **synced from two external datasets** — `models.dev` (`https://models.dev/api.json`) and `llm-metadata` (`https://basellm.github.io/llm-metadata/api/all.json`) — via `lib/pricing-sync.ts` (`previewSync`/`syncPricing`), driven by admins on the console pricing page. **`usage` rows are self-contained snapshots** — they copy the price fields at record time, so historical cost doesn't move when pricing changes. Cost logic is in `lib/{usage,chat-usage,video-usage,pricing,pricing-sync,quota,preflight}.ts` (all unit-tested).

### tRPC (`server/api/`)
Routers aggregated in `server/api/root.ts`. Three procedure tiers in `server/api/trpc.ts`: `publicProcedure`, `protectedProcedure` (logged-in), `adminProcedure` (`session.user.admin`). Context carries `{ db, session, headers }`.
- **Client components** call via `trpc/react.tsx` (`api.x.y.useQuery/useMutation`, React Query, batched HTTP).
- **Server components** call via `trpc/server.ts` (`createCaller`, direct in-process, no HTTP) — e.g. layouts prefetch with `await api.settings.getSystem()`.

### Auth (`server/auth.ts`)
NextAuth v5 beta, **JWT session strategy**, Drizzle adapter. Providers: Google, GitHub, and email one-time-code (Credentials + Resend). The **first user to sign up is auto-promoted to admin**; `users.role` → `token.admin` → `session.user.admin`.

### Frontend state — three contexts (wrapped in `app/(chat)/layout.tsx`, order matters)
`SystemSettingsProvider` (server-fetched: available models + defaults + app metadata) → `PreferencesProvider` (per-user choices persisted to `localStorage` key `user-preferences`, seeded from system defaults) → `ArtifactProvider`. Global providers (`app/layout.tsx`, theme/tooltip/toaster bundled in `components/providers.tsx`): `TRPCReactProvider` → theme (`next-themes`) → tooltip → toaster.

### Artifacts (the code/document canvas)
During chat, the model calls the `create_artifact` tool; the route streams `data-*` deltas. `contexts/artifact-context.tsx`'s `handleStreamPart` accumulates them into `ArtifactState` (kinds: text/code/image/sheet/file; status streaming→done→idle). `components/artifact-viewer.tsx` renders source vs. preview; React/TS code is compiled by `app/api/artifacts/preview/route.ts` (transpile + an import allowlist of only `react` / `react-dom` / `react-dom/client`) and rendered in the `app/artifact-preview-frame` iframe.

### Console (`app/console/`)
Admin-only (gated in `app/console/layout.tsx` via `session.user.admin`, and every console router uses `adminProcedure`). Manages providers, models, prompts, plans, pricing, quotas, users, usage, and system settings — i.e. all the DB-driven config the rest of the app reads.

## Conventions

- **Path alias**: `@/*` → repo root (e.g. `@/components`, `@/lib/utils`, `@/server`).
- **Prettier** (`prettier.config.mjs`): single quotes, semicolons, 2-space, **no trailing commas**. Import order is enforced by `@ianvs/prettier-plugin-sort-imports` — react/next first, then third-party, blank line, then `@/types` → `@/lib` → `@/hooks` → `@/server` → `@/trpc` → `@/components/ui` → `@/components` → relative. Tailwind classes auto-sorted. Run `pnpm format:write` after edits.
- **ESLint** (`eslint.config.mjs`) intentionally relaxes some rules: `no-explicit-any` off, native `<img>` allowed (`@next/next/no-img-element` off), unused vars are a warning and ignore `_`-prefixed names.
- **UI**: shadcn/ui (new-york style) over Radix primitives (imported from the unified `radix-ui` package) + Tailwind v4 (config-less, `app/globals.css`). Reuse `components/ui/*`; use `cn()` from `lib/utils`.
- **Radix + SSR hydration**: components rendering Radix `useId`-bearing primitives in the prompt forms guard against hydration-id mismatches with a `mounted` flag that renders a non-Radix placeholder until mounted (see `components/model-menu.tsx`, `components/prompt-picker.tsx`). Follow this pattern when adding similar interactive controls there.
- **IDs**: `generateUUID()` from `lib/utils`.
- Common shared maps/labels (provider types, capabilities, size/aspect/resolution labels, the artifact system prompt) live in `lib/constant.ts`; check there before hardcoding.
