import assert from 'node:assert/strict';
import { SportyBetClient } from '../../src/sportybet/SportyBetClient.js';

if (process.env.SPORTYBET_LIVE_SMOKE !== 'true') {
  throw new Error('Set SPORTYBET_LIVE_SMOKE=true to explicitly authorize the non-staking live smoke test.');
}

const client = new SportyBetClient({
  ...(process.env.SPORTYBET_API_BASE_URL ? { baseUrl: process.env.SPORTYBET_API_BASE_URL } : {}),
  ...(process.env.SPORTYBET_REGION ? { region: process.env.SPORTYBET_REGION } : {}),
  timeoutMs: Number(process.env.SPORTYBET_TIMEOUT_MS ?? 15_000),
  minIntervalMs: Number(process.env.SPORTYBET_MIN_INTERVAL_MS ?? 500),
  maxConcurrency: 1,
  maxRetries: Number(process.env.SPORTYBET_MAX_RETRIES ?? 2),
});

const [football, basketball] = await Promise.all([
  client.fetchFixtures('football'),
  client.fetchFixtures('basketball'),
]);
assert(football.length > 0, 'No current football fixtures returned');
assert(basketball.length > 0, 'No current basketball fixtures returned');

let chosen:
  | { eventId: string; marketId: string; selectionId: string; odds: number; specifier?: string }
  | undefined;
for (const fixture of [...football, ...basketball]) {
  if (fixture.status !== 'scheduled') continue;
  const active = (await client.getMarkets(fixture.providerEventId)).find(
    (selection) => selection.status === 'active',
  );
  if (active) {
    chosen = {
      eventId: active.eventId,
      marketId: active.providerMarketId,
      selectionId: active.providerSelectionId,
      odds: active.odds,
      ...(active.specifier ? { specifier: active.specifier } : {}),
    };
    break;
  }
}
assert(chosen, 'No safe scheduled selection with an active market was found');

// This endpoint creates a reusable selection/share code only. It never logs in, stakes, or submits a bet.
const created = await client.createBookingCode([chosen]);
assert.match(created.code, /^[A-Z0-9]+$/);
const loaded = await client.getBookingCode(created.code);
assert.equal(loaded.code, created.code);
assert(
  loaded.selections.some(
    (selection) =>
      selection.eventId === chosen.eventId &&
      selection.marketId === chosen.marketId &&
      selection.selectionId === chosen.selectionId,
  ),
  'Loaded share code did not contain the created selection',
);

console.log(
  JSON.stringify({
    status: 'passed',
    footballFixtures: football.length,
    basketballFixtures: basketball.length,
    code: created.code,
    selections: loaded.selections.length,
    currentOdds: loaded.currentOdds,
    warning: 'No wager was submitted.',
  }),
);
