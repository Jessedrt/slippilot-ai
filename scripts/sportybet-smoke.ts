import { loadConfig } from '../src/config/env.js';
import { SportyBetMarketMapper } from '../src/sportybet/mapper.js';
import { SportyBetWebProvider } from '../src/sportybet/web-provider.js';

const config = loadConfig();
const split = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const provider = new SportyBetWebProvider({
  apiBaseUrl: config.SPORTYBET_API_BASE_URL,
  region: config.SPORTYBET_REGION,
  timeoutMs: config.SPORTYBET_TIMEOUT_MS,
  minIntervalMs: config.SPORTYBET_MIN_INTERVAL_MS,
  maxConcurrency: config.SPORTYBET_MAX_CONCURRENCY,
  maxRetries: config.SPORTYBET_MAX_RETRIES,
  cacheTtlMs: config.SPORTYBET_CACHE_TTL_MS,
  timelineHours: config.SPORTYBET_TIMELINE_HOURS,
  pageSize: Math.min(config.SPORTYBET_PAGE_SIZE, 25),
  maxPages: Math.min(config.SPORTYBET_MAX_PAGES, 2),
  footballMarketIds: split(config.SPORTYBET_FOOTBALL_MARKET_IDS),
  basketballMarketIds: split(config.SPORTYBET_BASKETBALL_MARKET_IDS),
});

const event = (await provider.listUpcoming('football')).find((item) => item.status === 'scheduled');
if (!event) throw new Error('No scheduled football fixture was returned by SportyBet.');
const market = (await provider.getMarkets(event.providerEventId)).find(
  (item) => item.status === 'active' && Number.isFinite(item.odds) && item.odds > 1,
);
if (!market) throw new Error(`No active market was found for ${event.providerEventId}.`);

const selection = new SportyBetMarketMapper().toProviderSelection(market);
const code = await provider.createBookingCode([selection]);
const loaded = await provider.resolveBookingCode(code);
const sameSelection = loaded.some(
  (item) =>
    item.eventId === selection.eventId &&
    item.marketId === selection.marketId &&
    item.selectionId === selection.selectionId,
);
if (!sameSelection) throw new Error(`Booking code ${code} did not load back the selected outcome.`);

console.log(
  JSON.stringify(
    {
      ok: true,
      eventId: event.providerEventId,
      marketId: selection.marketId,
      selectionId: selection.selectionId,
      bookingCode: code,
      note: 'A non-staking SportyBet share code was created and read back. No wager was placed.',
    },
    null,
    2,
  ),
);
