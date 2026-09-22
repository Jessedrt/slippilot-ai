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
