# You.com research integration

Verified against the official You.com documentation on 15 September 2026:

- Search: `POST https://ydc-index.io/v1/search`
- Contents: `POST https://ydc-index.io/v1/contents`
- Answer: `POST https://api.you.com/v1/answer`
- Research: `POST https://api.you.com/v1/research`
- Authentication: `X-API-Key`

All four operations are non-mutating, idempotent research requests. SlipPilot AI validates their
current documented response shapes with Zod, applies a timeout and conservative concurrency limit,
honors `Retry-After`, and retries only timeouts, HTTP 429, and HTTP 5xx responses. The API key is never
placed in URLs, cache keys, response objects, or log metadata.

The integration is an evidence layer. Structured sports data remains authoritative for fixtures and
statistics, SportyBet remains authoritative for markets and odds, and the primary AI provider remains
responsible for final reasoning. You.com is called only for explicit research or freshness triggers
such as injury, lineup, suspension, coaching, travel, congestion, postponement, or major-news
uncertainty.

Search results are ranked by publisher quality, canonical URLs and matching text are deduplicated,
betting/tip sources are deprioritized, conflicting availability reports are flagged, and confidence is
reduced. Research confidence is capped as a small adjustment in the confidence engine; it cannot
dominate structured evidence.

Normalized metadata is stored in `ResearchSnapshot` and `ResearchSource`; unnecessary page bodies are
not persisted. Redis caches normalized responses using hashed request payloads. Cache failures and
You.com outages degrade gracefully without blocking analysis.

## Live validation

Normal tests mock every request and never need credentials. Run one harmless live Search request only
when a key is explicitly configured:

```powershell
$env:YOU_API_ENABLED='true'
$env:YOU_LIVE_SMOKE='true'
$env:YDC_API_KEY='...'
npm run you:smoke
```

No `YDC_API_KEY` was available during implementation, so Search, Answer, Research, and Contents were
not claimed as live-tested. Their endpoints and contracts were verified from current official
documentation.
