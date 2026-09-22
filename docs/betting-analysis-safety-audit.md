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

To enable them, implement `BasketballStatisticsProvider` using an authorized, documented source and
inject it into `MiniAppDependencies`. The adapter must map the vendor response into the strict snapshot
schema and preserve source URL/name and retrieval time. The required API key variable and cost depend on
the vendor selected; this PR does not claim that You.com or SportyBet supplies those licensed statistics.

## Remaining limitations

- Automatic basketball support is intentionally limited to full-game totals. Team totals, period
  totals, player props and winners need separate metric-specific evaluators before they can be automated.
- Confirmed lineups improve the evidence-quality label but are not fabricated when unavailable.
- The deterministic projection is a transparent scoring baseline, not a calibrated probability model.
- No live provider or wagering test is run in CI. All new tests use deterministic mocked providers and
  are never represented as live evidence.
- A preview deployment depends on the repository's Vercel integration and preview credentials; no
  production deployment is performed by this branch.
