# SlipPilot AI

AI-powered Telegram assistant for football and basketball analysis, SportyBet market exploration,
slip management, optimization, and supported booking-code preparation.

> SlipPilot AI provides statistical decision support, not guaranteed predictions. It never places a
> wager, moves bookmaker funds, or stores bookmaker passwords. Users remain responsible for every
> bookmaker action. 18+ only; gamble responsibly.

## Overview

SlipPilot AI is a modular Node.js service combining a conversational Telegram interface, REST health
and admin APIs, provider-neutral sports data, normalized betting markets, confidence scoring, slip
optimization, screenshot extraction contracts, and a guarded SportyBet integration boundary.

The default installation is safe: Telegram, AI, sports data, and SportyBet features remain disabled or
explicitly unavailable until valid provider credentials and implementations are configured. It never
returns fabricated fixtures, live odds, or booking codes.

## Features

- Natural-language parsing with validated LLM structured output and deterministic fallback
- Follow-up context for active slips, recent analyses, sports, fixtures, markets, and preferences
- Football and basketball provider contracts covering fixtures, form, statistics, injuries, lineups,
  standings, head-to-head records, and players
- Dynamic market normalization and cross-market ranking instead of a fixed shortlist
- Probability, confidence, data-quality, risk, and concise reasoning fields
- Beam-search slip optimization prioritizing confidence before target-odds proximity
- Intelligent split balancing odds, confidence, risk, fixture correlation, and ticket size
- Vision extraction schema with uncertain-field reporting and team-name normalization hooks
- SportyBet event/market mapping, refreshed-odds checks, suspended-market handling, and explicit
  capability errors
- Free/Pro entitlement model and modular payment-provider contract
- Fastify health/admin APIs, rate limiting, structured redacted logs, Redis caching, and Prisma/Postgres
- Docker, GitHub Actions, strict TypeScript, ESLint, Prettier, and Vitest

## Architecture

```text
Telegram -> intent parser -> conversation state -> sports providers
                                      |              |
                                      v              v
                              analysis/markets -> ranked candidates
                                      |
                                      v
                            optimizer / editor / splitter
                                      |
                                      v
                      SportyBet provider boundary -> validation -> code*

* Only through a separately configured and verified compliant provider adapter.
```

External data is validated at boundaries. Odds and active-market cache entries should use short TTLs
(recommended: 15–30 seconds) and must be refreshed directly before booking-code preparation.

## Project structure

```text
src/
  admin/       metrics and protected operational endpoints
  ai/          intent and screenshot structured-output contracts
  analysis/    confidence and data-quality scoring
  api/         Fastify REST service
  booking/     provider-slip preparation and odds-change checks
  bot/         Telegraf commands, buttons, messages, and handlers
  config/      Zod environment validation
  database/    Prisma client and persistent conversation state
  markets/     catalog normalization and ranking
  services/    Redis cache and state abstractions
  slips/       combined odds, beam-search optimization, ticket splitting
  sportybet/   replaceable provider contract, mapping, safe default adapter
  sports/      multi-provider sports data contract
  subscriptions/
  types/
  utils/
tests/
prisma/
.github/workflows/
docs/
```

## Requirements

- Node.js 22+
- PostgreSQL 15+
- Redis 7+
- A Telegram bot token for Telegram mode
- Optional AI and sports-provider credentials
- Docker and Docker Compose for containerized development

## Installation

```bash
git clone <repository-url> slippilot-ai
cd slippilot-ai
npm ci
cp .env.example .env
npm run prisma:generate
```

Create the database schema after setting `DATABASE_URL`:

```bash
npx prisma migrate dev --name init
```

## Environment variables

| Variable                                | Required          | Purpose                                          |
| --------------------------------------- | ----------------- | ------------------------------------------------ |
| `NODE_ENV`                              | yes               | `development`, `test`, or `production`           |
| `PORT`, `HOST`                          | yes               | REST listen address                              |
| `TELEGRAM_BOT_TOKEN`                    | for bot           | BotFather token                                  |
| `DATABASE_URL`                          | yes               | PostgreSQL connection URL                        |
| `REDIS_URL`                             | yes               | Redis connection URL                             |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | for AI/vision     | Structured intent and screenshot provider        |
| `SPORTS_PROVIDER`, `SPORTS_API_KEY`     | for live analysis | Selected sports provider                         |
| `SPORTYBET_PROVIDER_ENABLED`            | no                | Feature gate; an adapter is still required       |
| `LOG_LEVEL`                             | yes               | Pino log level                                   |
| `ADMIN_SECRET`                          | production admin  | At least 16 characters; sent in `x-admin-secret` |

Never commit `.env` or production credentials.

## Telegram setup with BotFather

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`, choose **SlipPilot AI**, and request an available username such as
   `@SlipPilotAI_bot` or `@SlipPilotBot`.
3. Put the returned token in `TELEGRAM_BOT_TOKEN` locally—never in source control.
4. Configure these commands with `/setcommands`:

```text
start - Start SlipPilot AI
help - Show help
today - Explore today's games
football - Football analysis
basketball - Basketball analysis
analyze - Analyze a match or ticket
markets - Explore current markets
slip - Show the active slip
readcode - Read a supported booking code
history - Recent activity
subscription - Current plan
pricing - Compare plans
clear - Clear conversation context
```

## PostgreSQL and Redis

For local services, use Docker Compose or point `DATABASE_URL` and `REDIS_URL` at managed instances.
Run Prisma migrations as a release step:

```bash
npx prisma migrate deploy
```

The `/health` response reports real dependency checks. A degraded optional provider does not falsely
appear healthy.

## Sports data provider setup

Implement `SportsProvider` in `src/sports/provider.ts`, validate every upstream response with Zod, add
timeouts/circuit breaking in the adapter, and choose it from configuration. Keep football and
basketball transformations inside the adapter; analysis consumes only normalized domain data.

## AI provider setup

Implement `StructuredIntentProvider` for a model that supports JSON structured output. Return exactly
the shape in `intentSchema`; Zod rejects invalid responses and the deterministic parser automatically
handles common instructions when AI is unavailable. Vision providers should return
`screenshotExtractionSchema` data and preserve uncertainty.

## SportyBet integration architecture

The public Nigeria browser experience was inspected on 15 September 2026. It showed dynamic fixtures,
SportRadar-style URL references, separate display IDs, extensive market categories, active/suspended
states, decimal odds, and booking-code loading. No official public server API or supported code-creation
contract was verified.

Accordingly, SlipPilot AI ships `UnsupportedSportyBetProvider` as the safe default and contains **no
invented endpoints**. See [the detailed findings](docs/sportybet-integration.md). A production adapter
must be based on a documented, permitted interface and implement event lookup, current markets,
code resolution, code creation, and health checks. The workflow always re-resolves IDs and refreshes
odds before code creation.

## Running locally

```bash
npm run dev
```

Without a Telegram token, the REST service still starts and logs that Telegram is disabled. Useful
endpoints:

- `GET /` — application metadata
- `GET /health` — PostgreSQL, Redis, sports-provider, and SportyBet health
- `GET /admin/metrics` — protected metrics (`x-admin-secret` header)

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run prisma:validate
```

Tests do not need production secrets or live provider access.

## Docker

Copy `.env.example` to `.env`, set required secrets, then:

```bash
docker compose up --build
```

This starts **SlipPilot AI**, PostgreSQL, and Redis with persistent local volumes. For production, use
secret injection rather than an image-baked `.env`, managed databases, TLS, backups, and platform health
checks.

## Production deployment

1. Provision PostgreSQL and Redis in the same region.
2. Inject validated environment variables through the platform secret manager.
3. Run `npm ci`, `npm run prisma:generate`, `npm run build`, and `npx prisma migrate deploy`.
4. Start with `npm start` behind TLS and a process/container supervisor.
5. Configure monitoring for `/health`, structured logs, error rates, provider latency, and rate limits.
6. Use one Telegram update strategy per deployment; the current app uses long polling.

## GitHub workflow

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`: install, Prisma generation,
typecheck, lint, tests, and production build. Every step fails the job on error.

## Security

- Secrets are environment-only and sensitive log fields are redacted.
- Telegram text is length-limited before parsing; structured data is Zod-validated.
- Fastify limits request bodies, request duration, and request rate.
- Provider implementations must add strict timeouts, response-size limits, retries with jitter, and
  circuit breakers appropriate to the provider.
- SlipPilot AI stores no bookmaker password and cannot deposit, withdraw, or auto-submit wagers.
- Protect `/admin/metrics` with a strong secret and network-level access control.

## Troubleshooting

- **Bot disabled:** set `TELEGRAM_BOT_TOKEN` and restart.
- **PostgreSQL unavailable:** verify `DATABASE_URL`, network access, migrations, and TLS requirements.
- **Redis unavailable:** verify `REDIS_URL`; live odds must never fall back to stale cache values.
- **No fixtures:** configure a `SportsProvider`; SlipPilot AI intentionally does not invent matches.
- **SportyBet unavailable:** the analyzed slip remains independent; add only a verified provider adapter.
- **Prisma engine download blocked:** allow access to Prisma's official binary host during install/build.

## API documentation

### `GET /`

Returns SlipPilot AI name, version, and service status.

### `GET /health`

Returns the live health state of PostgreSQL, Redis, the selected sports provider, and SportyBet adapter.
Optional integrations may be degraded while the API remains available.

### `GET /admin/metrics`

Requires `x-admin-secret`. Returns counters for users, analyses, slips, booking-code requests,
screenshots, AI requests, errors, and rate limits plus dependency and subscription summaries. Connect
the `MetricsService` interface to a durable metrics backend before horizontally scaling.

## License

Private project. All rights reserved.
