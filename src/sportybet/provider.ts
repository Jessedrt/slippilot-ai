import type { NormalizedMarket } from '../types/domain.js';
import {
  SportyBetCapabilityError,
  type ProviderSelection,
  type SportyBetEvent,
  type SportyBetProvider,
} from './contracts.js';

/**
 * Safe default adapter. SportyBet's public browser UI was inspected, but no official public API
 * contract for fixture ingestion or code creation was verified. A deployment must inject a
 * compliant adapter rather than relying on guessed or scraped endpoints.
 */
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
        'SportyBet booking-code resolution is not available through a verified interface.',
      ),
    );
  }
  createBookingCode(): Promise<string> {
    return Promise.reject(
      new SportyBetCapabilityError(
        'create-code',
        'SportyBet booking-code creation is not available through a verified interface.',
      ),
    );
  }
  health(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: false, detail: 'No verified provider adapter configured' });
  }
}
