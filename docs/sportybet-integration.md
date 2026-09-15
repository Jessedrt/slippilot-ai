# SportyBet integration findings

Inspection date: 15 September 2026  
Region inspected: Nigeria (`https://www.sportybet.com/ng/`)

## Verified browser-facing behavior

- The public sports page showed football and basketball fixtures without authentication.
- Fixture detail URLs included SportRadar-style event references such as `sr:match:<id>`.
- The UI also displayed a separate short event ID. These identifiers must not be assumed interchangeable.
- Fixture pages loaded a large, dynamic market catalog with categories including Main, Goals, Half,
  Bookings, Corners, Specials, Players, Teams, Minutes, and Match.
- Active selections displayed decimal odds. Suspended or unavailable selections were visibly marked
  and did not expose usable odds.
- The betslip included a booking-code input and described codes as a way to transfer a betslip between
  devices.

## Not verified

- No officially documented public SportyBet API was found during inspection.
- No supported server-to-server authentication contract was verified.
- No stable request/response contract for fixture, market, or selection ingestion was verified.
- No supported unauthenticated booking-code creation interface was verified.
- Code resolution and code creation were not tested with a real account or wager.

## Implementation decision

SlipPilot AI contains a provider interface, mapping services, odds-refresh workflow, suspended-market
handling, and an explicit unsupported default adapter. It intentionally contains no guessed SportyBet
URLs. A deployment may add a compliant adapter only after obtaining documented permission and a stable
contract. The bot never submits a wager, deposit, or withdrawal.
