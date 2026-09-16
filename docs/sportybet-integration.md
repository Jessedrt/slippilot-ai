# SportyBet browser-facing integration findings

Inspection date: 15 September 2026  
Region: Nigeria
Base URL: `https://www.sportybet.com`

SportyBet does not publish a supported developer API for this workflow. These findings describe the
current, undocumented interface used by its own public browser client. The adapter is isolated and
feature-gated because the contract may change without notice.

## Independently verified behavior

The public Nigeria site and its current first-party JavaScript bundles were inspected before the
adapter was implemented. Live requests then verified these same-origin routes:

- `GET /api/ng/factsCenter/sportList` — public sports catalog.
- `GET /api/ng/factsCenter/liveOrPrematchEvents?sportId=...` — grouped fixture discovery.
- `GET /api/ng/factsCenter/pcUpcomingEvents` — paginated pre-match fixtures; its current query includes
  `sportId`, `marketId`, `pageSize`, and `pageNum`.
- `GET /api/ng/factsCenter/event?eventId=...&productId=3` — full pre-match event and dynamic markets.
- `GET /api/ng/factsCenter/marketGroups?sportId=...` — dynamic market groups.
- `POST /api/ng/factsCenter/Outcomes` — selection tuple validation/current-odds refresh.
- `POST /api/ng/orders/share` — create a selection-only, non-staking share/booking code.
- `GET /api/ng/orders/share/{code}` — load a share/booking code.

The verified tuple is `{ eventId, marketId, outcomeId, specifier }`. A null specifier is explicit when
the market has no line. Successful envelopes currently use `bizCode: 10000`.

Current sport identifiers returned by the service are `sr:sport:1` for football and `sr:sport:2` for
basketball. They are kept in one adapter boundary and covered by tests; market IDs are not used as a
hardcoded catalog. Each event's actual markets and outcomes are normalized dynamically.

Football event detail was verified with hundreds of markets across Main, Goals, halves, handicap,
team totals, corners, cards/bookings, specials, and player/team groups. Basketball was separately
verified with winner (including overtime), totals, handicaps, halves, quarters, and team markets.

## Live code round trip

A single scheduled Liverpool v Tottenham 1X2 selection was refreshed, used to create non-staking
code `GRB48Y`, and loaded through the public code-reader route. The returned event ID, market ID,
outcome ID, and odds matched. No login, account credential, stake, bet submission, deposit, or
withdrawal was involved.

Run the opt-in validation with:

```powershell
$env:SPORTYBET_LIVE_SMOKE='true'
npm run sportybet:smoke
```

The smoke test discovers current football and basketball fixtures, chooses an active scheduled
selection, creates a share code, loads it, and compares the tuple. It is intentionally excluded from
normal tests and CI.

## Request safeguards

- Short in-process caches, bounded concurrency, a minimum request interval, and timeouts are
  configurable.
- Only GET requests retry after HTTP 429, HTTP 5xx, or timeout, using exponential backoff.
- Outcome-refresh and share-code POST requests are never automatically retried. An uncertain share
  response therefore cannot accidentally create multiple codes.
- All envelopes, events, markets, and outcomes are validated with Zod.
- Code creation performs an uncached event check, market/outcome/specifier validation, duplicate and
  incompatible-selection rejection, then a current-odds refresh.
- Suspended selections are reported; they are never silently removed.

## Deployment limitation

The interface was reachable from this development machine using the public browser request context.
Vercel reachability has **not** been tested because no Vercel deployment is configured. Operators
must run the smoke test from their actual deployment environment before enabling the provider.
SportyBet may rate-limit or block data-center traffic; AUREX does not bypass those controls.
