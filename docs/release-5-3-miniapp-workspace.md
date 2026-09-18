# AUREX 5.3 Mini App-first release

Production rollout follows PR #23 and the successful CI run on commit `3072d0d45d6d1e23e162019dc9cdd5b537b6b556`.

## User-visible functionality

- The Telegram bot retains `/start`, `/app`, `/menu`, `/help` as a Mini App launcher, plus its webhook and opt-in alert transport. Previously sent keyboard messages remain in old chat history. The bot does not perform conversational analysis.
- Paste a SportyBet code in Mini App Analyze to resolve live provider fixtures and market identities, receive a per-selection AI review, choose a specific currently active replacement market, remove selections or trim combined odds approximately by removing entire selections. Explicit reanalysis is required after trimming; creating a new code does not modify the original code and does not place a wager.
- Build scans today's future fixtures and eligible active markets first using Africa/Lagos calendar dates, then tomorrow and the following day only if the earlier calendar day has no verified eligible selections. A supplier error is not treated as no games. The actual chosen date is shown on the slip.
- Watchlist sync and preference controls are implemented in PostgreSQL; monitoring is scheduled daily at 09:00 WAT when enabled on production.

## Deployment checklist

1. Confirm Vercel production deployment Git commit contains PR #23 and that `https://slippilot-ai.vercel.app/app/` includes `code-analysis.js?v=5.4.0`, `watch-sync.js?v=5.3.0` and the unchanged four tabs.
2. Open the Mini App through Telegram to verify real provider-backed import, per-market edit, trim and later-day fallback; the browser alone lacks signed Telegram initData.
3. `CRON_SECRET` must be configured in Vercel Production, and SportyBet, database and Telegram bot configurations must be valid. Verify one scheduled cron run and real Telegram delivery before describing automatic notifications as operational. Previews never send real notifications.

If production still serves the earlier SHA, do not claim the release is live merely because GitHub has merged it.
