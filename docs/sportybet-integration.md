# SportyBet integration

Inspection date: 15 September 2026  
Region: Nigeria (`ng`)

## Browser-facing contract used by the adapter

SlipPilot AI now contains an opt-in adapter for SportyBet's undocumented public web interface. This is
not an official developer API and may change without notice. The adapter is disabled by default.

The currently corroborated Nigeria paths are:

- `GET /api/ng/factsCenter/pcUpcomingEvents` for upcoming fixtures, markets and odds.
- `POST /api/ng/orders/share` for anonymous, non-staking booking/share-code creation.
- `GET /api/ng/orders/share/{code}` for read-only booking-code loading.

Requests use `Accept: application/json`, `Content-Type: application/json`, and `Current-Country: NG`.
Fixture selections are represented by `eventId`, `marketId`, `outcomeId`, and an optional `specifier`
(such as `total=2.5`).

## Safety boundary

The adapter never logs in, requests bookmaker credentials, handles deposits or withdrawals, or submits
a wager. Its only write request is the share-code endpoint. Booking POST requests are single-attempt and
are never automatically retried.

Before code creation, SlipPilot refreshes each selected event/market/outcome, verifies the outcome is
active, preserves the market specifier, and rejects duplicate or suspended selections.

## Configuration

Set `SPORTYBET_PROVIDER_ENABLED=true` only after verifying the adapter from the deployment network.
The remaining `SPORTYBET_*` environment variables control region, base URL, timeout, pacing, retry,
cache, pagination and requested market IDs. No SportyBet API key is required by this adapter.

Football defaults cover a broad set of result, goals, handicap, half, corners and related markets.
Basketball defaults currently request Winner incl. OT (`219`), Handicap incl. OT (`223`), Over/Under
incl. OT (`225`) and Team Totals (`227`,`228`). Market IDs remain configurable because the upstream
interface is undocumented.

## Verification

Run the normal offline suite first:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Then, from a network that is allowed to reach SportyBet, run:

```bash
npm run sportybet:smoke
```

The smoke script fetches one scheduled football event, selects one active outcome, creates a non-staking
share code, loads it back, and verifies that the same event/market/outcome is present. It does not stake
money or place a wager.

A server-side HTTP `403` should be treated as a deployment/network restriction. Do not add anti-bot
evasion or fabricate alternate endpoints; keep the adapter disabled on that host until the interface can
be reached legitimately.
