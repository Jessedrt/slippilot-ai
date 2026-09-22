# AUREX betting-analysis safety audit

Audit branch: `fix/betting-analysis-safety-audit`

## Confirmed defects

- Live discovery copied bookmaker implied probability (`100 / odds`) into `modelProbability` and
  `confidenceScore`, despite having no statistical model output.
- Basketball markets were initially ranked by target-price proximity and diversity. No structured
  basketball statistics were required before an Over or Under could enter AI review.
- The AI quality gate accepted `caution` whenever its numeric score met the threshold.
- AI output combined evidence quality, recommendation support and risk in one `confidence` field.
- Mini App analysis tokens bound selection identity but did not bind the reviewed odds and assessment
  fields, allowing client-side assessment fields to be altered without invalidating a new token.
- Booking preparation checked exact market identity and odds but did not require a current structured
  assessment on every selection.
- A successful code response used the generic `ready` state rather than explicitly distinguishing a
  generated booking code from a wager.
- Redis used `lazyConnect: true` together with `enableOfflineQueue: false`, then issued cache commands
  without ensuring the connection was ready. This caused the observed non-writable-stream warning.
- `package.json` and `package-lock.json` were out of sync, so a clean `npm ci` failed before checks.

## Potential weaknesses found

- SportyBet's browser-facing API is undocumented and can change without notice.
- No authorized basketball statistics adapter or credential is configured in the repository.
- Legacy imported-code/editor tokens do not contain the new assessment digest. They remain restricted
  to their signed selection identities and quality threshold for compatibility, and receive a short
  server-side assessment lifetime during booking preparation.
- You.com can provide sourced research but is not, by itself, a licensed structured basketball box-score
  feed. It is not used as a silent substitute for the missing basketball statistics adapter.
- The repository's global Prettier check already reports many pre-existing files. Files changed by this
  audit are formatted, but reformatting the entire application is intentionally outside this safety PR.
  The recorded baseline was 124 files. After `src/app.ts` became a material integration change and was
  formatted, 123 untouched baseline files remain; no unrelated file was reformatted.

## Implementation summary

- `src/sports/basketball-statistics.ts`: added a strict, provider-neutral snapshot contract and a
  deterministic game-total evaluator. It requires at least five recent games per team, a fresh
  retrieval timestamp, an authorized traceable source, matching event identity, no contradictions and
  a parseable line. Pace is used when supplied for every sample. Unsupported market types fail closed.
- `src/sportybet/discovery.ts`: removed target-price scoring from eligibility and stopped presenting
  bookmaker implied probability as model probability or confidence.
- `src/sportybet/market-review.ts`: evaluates basketball game totals before AI/target optimization,
  rejects missing/stale/conflicting evidence, requires explicit `keep`, and preserves partial slips.
- `src/ai/*`: separated evidence quality, statistical support, risk, conflict state and verdict. Real
  provider schemas are strict. A `caution` verdict can no longer pass automatic generation.
- `src/api/mini-app-routes.ts`: added distinct response fields for verified odds, evidence quality,
  statistical projection, implied probability, analysis expiry, target status and booking-code status.
  New tokens bind assessment values as well as provider identities.
- `src/booking/workflow.ts`: requires supported, unexpired analysis; revalidates exact event/market/
  selection/specifier identity; requires explicit acceptance of material odds changes; and creates only
  a non-staking booking code.
- `src/services/cache.ts` and `src/you/client.ts`: added connection-state checks, bounded connection
  attempts, operation deadlines, recovery and sanitized optional-cache fallback logging.
- `public/app/*`: labels bookmaker odds, evidence-quality scores and statistical projections separately.
- `tests/*`: added deterministic regression coverage for evidence gates, target shortfalls, booking
  preflight states and Redis failure/recovery.

## Provider requirements and cost

No new environment variable is activated by this PR because the repository has no verified licensed
basketball data vendor selected. Production basketball automatic totals therefore fail safely with an
`Insufficient statistical evidence` response.

### Provider investigation (22 September 2026)

The live SportyBet Nigeria upcoming-events response was sampled directly (100-event page, basketball
sport ID `sr:sport:2`). It listed 26 competitions, including Euroleague, NBA, WNBA, Greece Basketball
League, Australia NBL, Slovenia 1. A SKL, Lithuania LKL, Denmark Basketligaen, Czech NBL, Chile LNB,
Vietnam VBA, France Nationale 1 and several women's, cup, friendly and lower-tier competitions. This is
a point-in-time bookmaker listing, not a permanent coverage claim; an adapter must check coverage and
map the exact fixture on every request.

| Provider                     | Documented fit                                                                                                                                                                                                                                                                                                                                                                                              | Commercial boundary                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-Sports API-Basketball    | Publishes a 427-league coverage table with schedule, historical data, standings, team/player statistics and odds flags per competition. Its table explicitly includes several leagues in the sampled SportyBet set (NBA/WNBA, Chile LNB, Czech NBL, Basketligaen, LKL and VBA). It says live games/events update every 15 seconds. Coverage flags vary by league and must be checked rather than inferred.  | Free tier: 100 requests/day; paid pricing starts at US$10/month. Account/API key and confirmation that the intended betting-analysis use and display/retention are licensed are required. |
| Sportradar Global Basketball | Documents real-time scoring/statistics “when available,” over 200 competitions, competition/season/team statistics, lineups, head-to-head and event mapping endpoints. Its public FAQ names Euroleague and TBSL, but its coverage matrix must be checked for every sampled SportyBet competition and data field. A 10-second live timeline delta is documented; endpoint cache/update rates otherwise vary. | 30-day trial is documented as 1,000 calls and 1 QPS. Production fees and data rights are order-form/contract based; obtain a production API key and written rights for this use.          |
| Sportmonks                   | Current official product documentation advertises football, cricket and Formula 1, not a basketball API.                                                                                                                                                                                                                                                                                                    | Not a candidate for this basketball requirement unless Sportmonks supplies separate written product documentation and rights.                                                             |

Recommendation: validate API-Sports first because its public coverage matrix overlaps more of the actual
SportyBet snapshot and its entry pricing is published. Before writing an adapter, obtain an API-Basketball
key and written confirmation of commercial betting-analysis, derived-statistics, caching and end-user
display rights. Run a credentialed coverage audit that records provider competition IDs and required
fields for all currently listed SportyBet competitions. If its statistics/lineup depth is insufficient,
request a Sportradar Global Basketball production quote and coverage export. Never fall back from an
unmapped competition to a similarly named league.

To enable them, implement `BasketballStatisticsProvider` using the selected licensed source and inject it
into `MiniAppDependencies`. The interface passes the SportyBet competition, teams, start time and event ID;
the adapter must resolve an exact provider event and return provider competition/event IDs. The schema
then checks competition, both teams and start time (15-minute maximum variance), source authorization,
retrieval time and all evidence fields. No credential or provider is currently configured, and this PR
does not claim that You.com or SportyBet supplies licensed statistics.

## Remaining limitations

- Automatic basketball support is intentionally limited to full-game totals. Team totals, period
  totals, player props and winners need separate metric-specific evaluators before they can be automated.
- Confirmed lineups improve the evidence-quality label but are not fabricated when unavailable.
- The deterministic projection is a transparent scoring baseline, not a calibrated probability model.
- No live provider or wagering test is run in CI. All new tests use deterministic mocked providers and
  are never represented as live evidence.
- A preview deployment depends on the repository's Vercel integration and preview credentials; no
  production deployment is performed by this branch.

## API-Sports integration

### Architecture

The independent evidence path is now:

1. SportyBet supplies scheduled events, active market IDs, selections, odds and booking codes.
2. `ApiSportsFixtureMatcher` requests the UTC date from API-Football or API-Basketball and accepts only
   one exact competition/team/orientation match within 15 minutes of the SportyBet kickoff.
3. Stable API-Sports fixture, competition and team IDs are used for subsequent history requests.
4. Football totals require five completed same-season home matches for the home team and five away
   matches for the away team. The projection combines their venue-specific scoring/conceding averages.
5. Basketball totals use pace/possession inputs only when supplied for every sample. Without them, the
   score-only alternative requires eight recent venue-relevant games per team and a six-point margin;
   missing regulation quarter scores reject regulation-only markets.
6. The existing strict AI `keep` gate, target-odds preference and final SportyBet booking preflight still
   run after statistical eligibility.

`ApiSportsClient` uses the documented direct API hosts, sends `x-apisports-key` only from the backend,
validates the response envelope and sport schemas, treats HTTP-200 `errors` as failures, handles 401,
403, 429, quota headers and timeouts, bounds retries, and uses 2-minute fixture / 15-minute historical
cache TTLs. Redis failure affects only the cache, never the mandatory provider request.

### Production flags and credentials

- `API_SPORTS_KEY`: newly rotated backend credential. The previously exposed key must not be reused.
- `API_SPORTS_ENABLED=false`: constructs the client only when explicitly enabled.
- `API_SPORTS_COMMERCIAL_USE_APPROVED=false`: records that written commercial/publication permissions
  are declared. This legacy flag is deliberately not inferred from payment or API access and is not,
  by itself, accepted as proof of competition data rights.
- `API_SPORTS_DATA_RIGHTS_CONFIRMED=false`: separate fail-closed production gate for written provider
  and any required rights-holder permissions for the configured competitions and uses.
- `API_SPORTS_FOOTBALL_ENABLED=false`: enables verified API-Football goal-total evaluation.
- `API_SPORTS_BASKETBALL_TOTALS_ENABLED=false`: enables API-Basketball totals only after field coverage
  and rights are verified.
- `API_SPORTS_TIMEOUT_MS=8000`, `API_SPORTS_MAX_RETRIES=2`: bounded transport controls.
- `API_SPORTS_VERIFIED_MAPPINGS_JSON`: operator-reviewed SportyBet names mapped to stable provider IDs;
  mappings never bypass kickoff, orientation, sport or fixture-status validation.
- `API_SPORTS_ANALYSIS_CONCURRENCY=2`, `ANALYSIS_DEADLINE_MS=42000`: bounded analysis work and a
  structured stop before the hosting timeout.

The configuration rejects sport feature flags unless the client and commercial-approval flag are both
enabled. The key is never returned to the Mini App, included in URLs, or written to logs.

### Coverage snapshot and credential boundary

On 22 September 2026, a direct read of the first 100-item SportyBet Nigeria upcoming-events page returned:

| Sport      | SportyBet page result                                                                                                                                   | API-Sports exact mapped count                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Football   | 100 unique fixtures across Bundesliga, EFL Cup, LaLiga, Premier League, Serie A and UEFA Champions League                                               | Not run: no rotated credential/verified entitlements available |
| Basketball | 80 unique fixtures across 22 competitions, including Euroleague, NBA, WNBA, NBL, LKL, Basketligaen, VBA and several lower-tier/women's/cup competitions | Not run: no rotated credential/verified entitlements available |

These are point-in-time first-page SportyBet results, not full or permanent coverage claims. The new
coverage reporter produces total, mapped, unmapped, ambiguous, reversed-orientation and unsupported-
competition counts from a credentialed run. Mock coverage tests are labelled deterministic tests and
are not presented as live coverage.

### Licensing boundary

API-Sports' published terms prohibit unapproved direct resale, state that API-Sports does not itself
grant publication licences or commercial rights for competitions, and warn that betting-platform use
may require additional licences from rights holders. Before either sport flag is enabled, obtain written
confirmation covering commercial betting analysis, derived projections, cache retention, end-user
display, intended countries and request volume from API-Sports and any required competition rights
holders. Confirm separately that the account/key is entitled to API-Football and API-Basketball and
record the daily/per-minute quotas for both products.
