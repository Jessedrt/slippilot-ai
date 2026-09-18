# AUREX 5.3 watchlist operations

## What is implemented

The Mini App's Explore tab has a server-backed watchlist keyed exclusively to **verified Telegram Mini App initData**. The watchlist, quiet-hour settings, per-match mute controls and explicit notification opt-in live in the existing PostgreSQL `User.preferences.aurexWatch53` JSON. Existing unrelated user preferences are preserved. The old on-device watchlist is **not silently overwritten**: if its IDs are not in the cloud list, the UI offers an explicit provider-verified import. No new database migration is needed.

A new watch starts with a provider-verified `getEvent` snapshot. Subsequent manual checks or authorized cron runs compare provider-returned fixture **status** and **kickoff time**. Missing/errored provider lookups are labelled unverified; they **never** become a cancellation. Only confirmed changes while opted in and not muted can queue a Telegram alert. Telegram `sendMessage` responses must confirm success; failed deliveries stay pending for retry. Quiet hours use `Africa/Lagos` time. Queued updates expire after six hours to avoid sending outdated changes. The service uses a per-record lease to reduce duplicate deliveries, though Telegram cannot guarantee exactly-once delivery across network failures.

## Release checklist (not performed by a preview)

1. Set a strong, private `CRON_SECRET` of 16–256 characters in **Vercel Project → Settings → Environment Variables → Production**. Never commit it to GitHub. Vercel supplies `Authorization: Bearer <CRON_SECRET>` on scheduled invocations.
2. Confirm the existing `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` and `SPORTYBET_PROVIDER_ENABLED=true` are configured for Production. If the SportyBet provider is disabled or credentials are missing, alerts are unavailable.
3. Merge the reviewed pull request, deploy to **production**, and inspect Vercel's Cron Jobs dashboard. A schedule in `vercel.json` alone does not prove that the job is firing.
4. The configured cron runs once daily at **08:00 UTC (09:00 Lagos)**. This is *not* real-time monitoring. The function checks up to five opted-in accounts and 12 watched fixtures per account each run (larger lists rotate on subsequent runs). Accounts are selected by oldest update time. If usage grows, add a scalable queue and increase schedule frequency according to your Vercel plan before promising prompt alerts.
5. From an authenticated Telegram session, watch a verifiable fixture, explicitly turn notifications on, and confirm saved settings on another device. Check Vercel logs for an authenticated cron invocation and use a controlled test fixture/mocked provider in a non-production environment to confirm dispatch logic. Live sending must be verified separately after deployment; preview deployments never send messages.
6. Verify `401` for absent/incorrect cron authorization and verify that preview environments return `404` for the cron route. Do not expose this endpoint as an unauthenticated manual trigger.

## User-visible limitations

- Manual Refresh checks provider data but does **not** send messages. Alerts are disabled by default. The preview never sends Telegram messages, even if users save opt-in preferences.
- No lineup or injury alerts: the provider interface does not expose verified data for those fields.
- This release alerts on fixture status/kickoff changes only, **not** odds changes or guaranteed betting outcomes.
- A fixture not returned by the provider is marked unverified. Alerts may be missed because the monitor is daily, account-batched, quiet hours suppress delivery, users can block the bot, and the provider can be unavailable.
- App notification settings must display alert availability; saved preferences alone do not guarantee a working scheduler.
- Analysis history remains device-local in AUREX 5.3. Only the watchlist and alert preferences are synchronized.
