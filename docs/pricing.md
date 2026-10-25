# Pricing

How a model is priced, how its price is saved and synced, how a call is
billed, and what a usage row says when its price could not bill everything.

## Principles

1. **A model is priced one way.** Each kind of model has a few ways of being
   priced (below); a model has the rates of exactly one, and no rate its kind
   does not carry — an image model no cache rate, a chat model no audio rate.
2. **A price is used as it is set.** The code does not stand in for a price
   that is not set, except where a rule below says which rate stands in:
   - a chat model's Reasoning, not set, is billed at its Output rate;
   - an image model priced per token: Output, not set, at its Image output
     rate, and Image input, not set, at its Input rate;
   - priced per resolution: a resolution with no rate set, and a call that
     sends none, at the highest rate set.
3. **Not set and 0 are different.** A rate left blank is stored as null — not
   set. A rate of 0 is set, and free.
4. **Prices are cost prices.** What a call costs is billed at them; what the
   user spends is that cost times their tier's multiplier, and quotas count
   the spend.

## Ways of pricing

A chat model has one way, its rates added together. Every other kind chooses
one of its ways. The ways and their rates — a chat model's one among them, and
so every rate each kind carries — are defined once, in `PRICING_MODES`
(`src/lib/constant.ts`), for the console and the price sync alike.

| Kind          | Way                     | Required                           | Optional                                                            |
| ------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Chat          | —                       | Input, Output                      | Reasoning, Cache read, Cache write, Web search, X posts, X profiles |
| Image         | Per image               | Per image (0 allowed)              | —                                                                   |
|               | Per resolution / image  | A rate for one resolution at least | —                                                                   |
|               | Per token               | Input, Image output                | Output, Image input                                                 |
| Video         | Per video               | Per video (0 allowed)              | —                                                                   |
|               | Per second              | Per second (0 allowed)             | —                                                                   |
|               | Per resolution / second | A rate for one resolution at least | —                                                                   |
|               | Per token               | Video output                       | Input, Output                                                       |
| Speech        | Per 1M characters       | Per 1M characters                  | —                                                                   |
|               | Per token               | Input, Audio output                | Output, Audio input                                                 |
| Transcription | Per minute              | Per minute                         | —                                                                   |
|               | Per token               | Audio input, Output                | Input, Audio output                                                 |

X posts and X profiles are offered only for a model served through xAI.

## Saving a price (console)

- Edit Pricing shows the ways of a kind as tabs, and the rates of the way
  chosen. Saving keeps those rates and clears every other way's — only the
  chosen way is stored.
- The resolutions priced per resolution are the model's own options (sizes and
  resolutions, `auto` left out). Only those the model takes now are saved.
  Per resolution is offered only for a model whose options name sizes or
  resolutions.
- The server checks every save (`pricingStyleConflict`,
  `pricingMissingFields`): rates of two ways at once, or a required rate
  missing, are refused.
- A blank rate is stored as null; nothing is filled in for it.
- A rate the model's kind does not carry is stored as null, whatever sent it
  (`strayRatesOf`).
- The form names no provider or model. A way with a single rate titles its
  field as its tab is titled; the form carries no notes beyond its
  placeholders, which say which rate stands in for one left blank.

## Before a call

A model with no price, or one missing a required rate, is refused before the
call (`requirePricing`): the user is told the model is unavailable.

## Price sync

Prices are synced from models.dev or llm-metadata, which list a provider's own
prices or nothing (`src/server/services/pricing-sync.ts`).

1. A model the source does not list, or lists no price of its kind for, keeps
   its prices.
2. The source's rates say which way the model is priced. Those rates are
   written; a rate of that way the source does not list keeps what it has; the
   rates of every other way — those entered by hand, per resolution among
   them — are cleared. As the sources quote them, an image model's output is
   its Image output, and the output of a speech model priced only in and out
   is its Audio output.
3. A model that worked before and would be left missing a required rate is not
   written, and is reported as skipped with the reason.
4. A chat model has its listed rates written, and keeps the rest.
5. A rate the model's kind does not carry is not written, and one already
   there is cleared — a cache rate listed for an image model, an audio rate
   for a chat model.

## Billing a call

The cost engine is `src/server/services/pricing.ts`; usage is recorded by
`src/server/services/usage.ts`.

| Kind          | Way               | Cost                                                                                                                                                   |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat          | —                 | Input, output, reasoning, cache read and cache write tokens each at its rate per 1M, plus web searches, X posts and X profiles each at its rate per 1K |
| Image         | Per image         | Images × the rate                                                                                                                                      |
|               | Per resolution    | Images × the rate of the resolution sent, else the highest                                                                                             |
|               | Per token         | Words read × Input + pictures read × Image input + words written × Output + pictures drawn × Image output, per 1M                                      |
| Video         | Per video         | Videos × the rate                                                                                                                                      |
|               | Per second        | Seconds × the rate                                                                                                                                     |
|               | Per resolution    | Seconds × the rate of the resolution sent, else the highest                                                                                            |
|               | Per token         | Tokens read × Input + (words written + thought) × Output + the video's tokens × Video output, per 1M                                                   |
| Speech        | Per 1M characters | Characters × the rate per 1M                                                                                                                           |
|               | Per token         | Each kind of token at its rate, per 1M                                                                                                                 |
| Transcription | Per minute        | Seconds ÷ 60 × the rate                                                                                                                                |
|               | Per token         | Each kind of token at its rate, per 1M                                                                                                                 |

A rate that is not set, with nothing standing in for it, bills what it prices
at nothing — and the usage row says so (below).

### The quantities billed

- **Images and videos** are counted on every call.
- **A video's seconds** are the length its provider reports it made, else the
  length read from the video itself (as for Sora and Gemini Omni).
- **A transcription's seconds** are the length its provider reports, else the
  length read from the audio.
- Seconds are rounded to three places before they are billed, as the usage row
  keeps them, so the Logs itemize what was billed.
- **Tokens** are those the provider reports.
- **Characters** are counted from the text read, which is never empty.
- **The resolution** is the one sent to the provider. xAI makes a video from
  reference images at 720p at most, so a 1080p asked for is sent as 720p. An
  edit sends none.

## What a usage row says

A usage row's `reason` says where its price did not bill everything — a
pricing to change, or a price to set. The cost engine finds it while it
bills; the usage service writes it.

1. **Not supported — change the pricing.** The way the model is priced needs a
   quantity the model does not report: priced per token with no tokens
   reported, or per second, per resolution or per minute with no length. The
   call is billed nothing.
   > Per token not supported — change the pricing.
2. **Used with no price — set it.** The call used something whose rate is not
   set, with nothing standing in for it. That part is billed nothing; the rest
   as priced.

   > Cache read: no price — set it.

   > Web search, X posts: no price — set them.

The way is named by its tab, and what was used by its rate's field. A rate set
to 0 says nothing. Nothing is said of a cost above or below what the provider
charges — prices are the operator's to set — nor of a chat that reported no
tokens.

In the Logs, a row with a reason shows it in red beneath its items, and its
spend in red.
