import type { AppConfig } from '../config/env.js';
import type { NormalizedMarket } from '../types/domain.js';
import {
  SportyBetCapabilityError,
  type ProviderSelection,
  type SportyBetEvent,
  type SportyBetProvider,
} from './contracts.js';
import { SportyBetWebProvider } from './web-provider.js';

export class UnsupportedSportyBetProvider implements SportyBetProvider {
  readonly name = 'SportyBet' as const;
  findEvents(): Promise<SportyBetEvent[]> {
    return Promise.reject(
      new SportyBetCapabilityError('events', 'SportyBet event integration is not configured.'),
    );
  }
  getEvent(): Promise<SportyBetEvent | null> {
    return Promise.reject(
      new SportyBetCapabilityError('events', 'SportyBet event integration is not configured.'),
    );
  }
  getMarkets(): Promise<NormalizedMarket[]> {
    return Promise.reject(
      new SportyBetCapabilityError('markets', 'SportyBet market integration is not configured.'),
    );
  }
  resolveBookingCode(): Promise<ProviderSelection[]> {
    return Promise.reject(
      new SportyBetCapabilityError(
        'resolve-code',
        'SportyBet booking-code resolution is not configured.',
      ),
    );
  }
  createBookingCode(): Promise<string> {
    return Promise.reject(
      new SportyBetCapabilityError(
        'create-code',
        'SportyBet booking-code creation is not configured.',
      ),
    );
  }
  health(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: false, detail: 'SportyBet provider disabled' });
  }
}

const marketIds = (value: string) =>
  [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

export function createSportyBetProvider(config: AppConfig): SportyBetProvider {
  if (!config.SPORTYBET_PROVIDER_ENABLED) return new UnsupportedSportyBetProvider();
  return new SportyBetWebProvider({
    apiBaseUrl: config.SPORTYBET_API_BASE_URL,
    region: config.SPORTYBET_REGION,
    timeoutMs: config.SPORTYBET_TIMEOUT_MS,
    minIntervalMs: config.SPORTYBET_MIN_INTERVAL_MS,
    maxConcurrency: config.SPORTYBET_MAX_CONCURRENCY,
    maxRetries: config.SPORTYBET_MAX_RETRIES,
    cacheTtlMs: config.SPORTYBET_CACHE_TTL_MS,
    timelineHours: config.SPORTYBET_TIMELINE_HOURS,
    pageSize: config.SPORTYBET_PAGE_SIZE,
    maxPages: config.SPORTYBET_MAX_PAGES,
    footballMarketIds: marketIds(config.SPORTYBET_FOOTBALL_MARKET_IDS),
    basketballMarketIds: marketIds(config.SPORTYBET_BASKETBALL_MARKET_IDS),
  });
}
