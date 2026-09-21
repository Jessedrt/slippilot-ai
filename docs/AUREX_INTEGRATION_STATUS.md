# Aurex preview integration status

Preview branch: `design/aurex-full-redesign-preview-20260921`. Production/main is not changed by this branch.

| Surface | Real source | Access requirements | Honest failure mode |
| --- | --- | --- | --- |
| Build / Analyze / My Slip | Existing SportyBet provider and You.com AI analysis; signed session | `TELEGRAM_BOT_TOKEN`, `SPORTYBET_PROVIDER_ENABLED=true`, `YOU_API_ENABLED=true`, `YDC_API_KEY`; valid Telegram Mini App initData | No invented odds, picks, booking codes or AI scores |
| SportyBet code generation | Existing backend import/market reconciliation, signed analysis token | Telegram Mini App, SportyBet provider and valid original markets | Explain unavailable/changed odds; no wager submission |
| Explore fixtures and market comparisons | Existing SportyBet fixture/market service | Telegram Mini App, enabled supported provider | Show unverified/error states, not placeholder matches |
| Watchlist and analysis history | Device-local saved fixtures and sourced analyses | Browser storage; Telegram for provider refresh | Manual refresh only; no fake background notifications |
| News | You.com Web Search API's `results.news`; original article URLs, headline, description and date | Telegram Mini App, `YOU_API_ENABLED=true`, `YDC_API_KEY`, `YOU_SEARCH_ENABLED=true` | No synthetic articles; transparent 503 when unavailable |
| Screenshot understanding | Existing configured Gemini vision adapter | `GEMINI_API_KEY` or legacy `AI_API_KEY`, supported image | Explain missing service or unreadable image |

News is cached for 15 minutes per server instance and by the existing You.com client/Redis cache. Only sports-specific fixed queries are accepted; arbitrary search strings and untrusted URLs are not forwarded. Titles, snippets and publication dates come from the provider, without invented scores or outcomes. All `/api/miniapp/*` routes require valid Telegram-signed initData and return HTTP 503 if the preview lacks its bot token. When deploying to production, configuration validation still requires the bot token, webhook secret and managed database/Redis URLs.

The Preview environment must be configured separately from Production for the full live flow. The connector in this environment cannot view or change Vercel secrets. Never paste keys in GitHub, this document or chat.

Before production: verify deployment for the current commit, view it on a phone, test a real Telegram code import / editor / code generation, and receive explicit sign-off on the actual design. A successful build alone is not a full integration test.
