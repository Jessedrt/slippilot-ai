# AUREX AI provider architecture

- **You.com / YDC Research (`standard` with structured JSON output)** performs all required textual slip analysis for both Telegram and the Mini App. You.com Search, Answer, Contents and research continue to power public-web context. Text analysis NEVER falls back to Gemini.
- **Gemini Vision** is optional and only handles uploaded images/screenshots. Set `VISION_MODEL=gemini-2.5-flash` and a `GEMINI_API_KEY` for image extraction. `AI_PROVIDER` and `AI_MODEL` are legacy variables and do not control textual analysis.
- **Public X/Twitter links** use the existing public oEmbed text reader without Gemini. Private, deleted, or inaccessible posts cannot be reliably read; do not fabricate content. You.com does not automatically gain access to restricted posts.
- **SportyBet** provides fixture/market/odds validation and non-staking share codes only. Actual wagers are never placed automatically.

## Production configuration

In the **slippilot-ai** Vercel project, set `YOU_API_ENABLED=true`, `YOU_RESEARCH_ENABLED=true`, and at least one `YDC_API_KEY` (additional numbered keys optional). `YOU_TIMEOUT_MS=60000` is suggested for structured Research; the serverless route has a 60-second maximum and expensive/multi-leg research can time out. Ensure your You.com account supports Research `standard` and has sufficient credits. Gemini key is only needed for image reading. Keep all secrets in Vercel: never commit them or post them in a chat.

**Before merging or enabling live traffic**, independently run a live request from a deployment with its intended YDC key to verify the actual Research standard structured response and latency. Offline unit tests use mocked responses and do **not** establish that the live API/plan works. If YDC is unavailable or response validation fails, analysis fails closed; AUREX does not issue an unreviewed booking code.

## Migrations and CI

`npm run build` now generates the Prisma client and compiles TypeScript without requiring network access to production PostgreSQL. This enables reproducible CI and prevents preview builds from mutating a production database. **When a database schema migration is introduced**, run `npm run db:migrate:deploy` once as a separate, controlled release step with the correct target database credentials before deploying code that requires the new schema. No schema migration is included in this YDC-primary change.

Validate using `npm ci --include=dev`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. The live You.com test `YOU_LIVE_SMOKE=true npm run you:smoke` is opt-in and requires a securely configured key. Then test an actual slip in the preview app before merging.
