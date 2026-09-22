# API-Sports pipeline repair

Date: 22 September 2026

This document describes the fixture-mapping and latency repair. It does not claim that a live
API-Sports coverage run, live SportyBet booking, wager, or production deployment was performed.

## Confirmed root causes

1. Fixture matching accepted only exact normalized competition and team display names. Common safe
   display differences such as accents, `&` versus `and`, and `Utd` versus `United` could not map,
   even when date, kickoff and orientation agreed.
2. There was no operator-reviewed SportyBet-name to API-Sports-ID registry. A legitimate naming
   difference therefore had no strict path to a stable provider identity.
3. The statistics evaluators repeated exact bookmaker/provider display-name checks after the fixture
   matcher. This caused a verified alias to fail a second time.
4. A single `FixtureMappingError` escaped the per-fixture review loop and aborted the entire slip.
   Mapping failures and systemic provider failures were not separated.
5. Build work was amplified by serial statistics and final SportyBet verification loops, repeatable
   identical provider calls, and a candidate inspection ceiling as high as 60 fixtures.
6. `createApplication()` forced the You.com per-attempt timeout to at least 45 seconds. The client
   could then retry across multiple keys, so one AI stage could exceed Vercel's 60-second request
   limit before the remaining preflight work ran.
7. The final market score still contained a target-price distance penalty. This allowed price
   proximity to compete with stronger evidence after eligibility checks.
8. The Mini App had no server-side deadline before Vercel's limit, no user cancellation control,
   and no correlated phase timings. An uncontrolled host 504 was therefore possible.
9. `/status` authentication, feature activation, fixture retrieval, statistics retrieval and a
   verified selection were presented too closely even though they prove different things.
10. The Analyze tab still had an old count-only booking-code handler alongside the full import and
    analysis workflow. It could echo a code/count response instead of showing a meaningful review.

## Potential weaknesses, not asserted as proven production failures

- SportyBet display names and schedules can change. Strict mappings need ongoing operator review.
- A process-local diagnostic snapshot resets between serverless instances. It is useful for a
  correlated request but is not a durable monitoring store.
- API-Sports competition coverage and field depth vary. Authentication and a subscription do not
  establish historical sample depth for a given SportyBet competition.
- Score-only basketball projection is a conservative transparent baseline, not a calibrated model.
  It remains unavailable unless the exact fixture, overtime convention, recent venue samples and
  required margin all validate.

## Repaired data flow

1. SportyBet supplies scheduled fixtures, exact active market/outcome/specifier IDs and odds.
2. Discovery checks today first. Later days are considered only under the existing verified-empty-day
   fallback policy.
3. API-Sports retrieves the exact UTC date, plus an adjacent date only when the 15-minute kickoff
   window crosses midnight.
4. The matcher requires one competition, home team, away team, orientation, kickoff and scheduled
   status match. Operator-reviewed stable provider IDs override display-name comparison; loose fuzzy
   similarity never establishes identity.
5. An unmapped, ambiguous, reversed, stale-status or kickoff-mismatched fixture is rejected locally.
   Authentication, entitlement, quota, timeout and malformed-response failures abort the whole build.
6. Historical data is retrieved by the matched provider team, competition and season IDs. Football
   uses completed `FT-AET-PEN` fixtures. Basketball accepts only completed `FT`/`AOT` games and uses
   regulation quarter sums when the market excludes overtime.
7. Strict sport-specific schemas and freshness/sample checks run before AI review. Odds are displayed
   separately as bookmaker-implied probability and never used as statistical proof.
8. Only an AI `keep` verdict that also meets the unchanged quality policy can continue.
9. Exact SportyBet outcomes are refreshed with bounded concurrency. Material price changes remain
   subject to the existing signed-token booking workflow and user approval.
10. The target odds are reported against actual combined odds. No extra unsupported market is added
    to fill a target.

## Mapping policy

`API_SPORTS_VERIFIED_MAPPINGS_JSON` is a strict JSON object with `competitions` and `teams` arrays.
Each entry contains:

- `product`: `football` or `basketball`;
- `sportyBetName`: the exact reviewed SportyBet display name;
- `apiSportsId`: a positive stable API-Sports ID obtained from a credentialed coverage review.

Duplicate names, unknown fields, non-positive IDs and malformed JSON stop application initialization.
Mappings are still checked against sport, kickoff, orientation and scheduled status. They do not force
a match. Unreviewed similarity is never persisted automatically.

## Performance and quota controls

- At most 24 fixtures are inspected. The cap remains large enough to return later valid fixtures and
  never changes evidence thresholds.
- Statistics review defaults to two concurrent fixtures; final SportyBet preflight is bounded to four.
- Identical in-flight API-Sports and You.com requests share one promise.
- API-Sports fixture lists cache for 120 seconds; historical samples cache for 900 seconds. Cached
  timestamps are revalidated before use and optional Redis failure falls back to a mandatory live call.
- API-Sports retries only bounded transient failures. Rate limits, daily quota exhaustion, missing
  product entitlement and HTTP-200 provider errors are explicit failures.
- You.com defaults to two attempts, a 15-second attempt timeout and a 25-second total deadline.
- The build deadline defaults to 42 seconds and is capped at 50 seconds, leaving time for a structured
  response before Vercel's 60-second execution limit.

## Operational diagnostics

The Telegram-authenticated status route reports football and basketball separately:

- credential authentication result;
- effective feature activation and the exact activation block;
- declared commercial approval and separate confirmed-data-rights gate;
- quota values returned by `/status`;
- whether fixture retrieval, statistics retrieval and a verified analysis have actually run;
- live request, cache-hit and failure counts for the current serverless process;
- reviewed mapping counts.

The user-triggered coverage route checks at most 20 real scheduled SportyBet fixtures with a 20-second
deadline and reports exact mapping/rejection counts. It does not run automatically and does not claim
historical-statistics coverage, licensing approval or a betting outcome.

## Environment variables

- `API_SPORTS_KEY`: rotated backend-only credential. Never reuse a key exposed in chat.
- `API_SPORTS_ENABLED`: constructs the shared backend client.
- `API_SPORTS_FOOTBALL_ENABLED`: requests API-Football analysis.
- `API_SPORTS_BASKETBALL_TOTALS_ENABLED`: requests API-Basketball total analysis.
- `API_SPORTS_COMMERCIAL_USE_APPROVED`: retained declaration; not treated as proof of rights.
- `API_SPORTS_DATA_RIGHTS_CONFIRMED`: separate production gate, default `false`.
- `API_SPORTS_VERIFIED_MAPPINGS_JSON`: operator-reviewed stable-ID mappings.
- `API_SPORTS_TIMEOUT_MS`, `API_SPORTS_MAX_RETRIES`: bounded transport settings.
- `API_SPORTS_ANALYSIS_CONCURRENCY`: statistics review concurrency, default `2`.
- `ANALYSIS_DEADLINE_MS`: server build deadline, default `42000`, maximum `50000`.
- `YOU_TOTAL_TIMEOUT_MS`, `YOU_MAX_ATTEMPTS`: total research deadline and attempt bound.

No variable is exposed to browser JavaScript. The key is sent only in the backend
`x-apisports-key` header and is redacted from errors and tests.

## Licensing and credential boundary

The provider's published terms do not themselves grant every publication, betting-platform or
competition right. `API_SPORTS_DATA_RIGHTS_CONFIRMED` therefore defaults to `false` even when `/status`
authenticates. Before production analysis is enabled, obtain written confirmation covering the exact
football and basketball competitions, commercial betting analysis, derived projections, end-user
display, cache retention, territories and expected volume. Confirm API-Football and API-Basketball
entitlements and quotas independently.

Without a securely supplied rotated credential, credentialed fixture/statistics and real coverage
tests remain blocked. Deterministic mocks validate transport, schema, mapping and failure behavior but
are not evidence of live provider coverage.
