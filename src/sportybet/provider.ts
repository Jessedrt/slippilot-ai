import type { NormalizedMarket } from '../types/domain.js';
import {
  SportyBetCapabilityError,
  type ProviderSelection,
  type SportyBetEvent,
  type SportyBetProvider,
} from './contracts.js';
import { SportyBetClient, type SportyBetClientOptions } from './SportyBetClient.js';
import { SportyBetFixtureCatalog } from './fixture-catalog.js';

export class BrowserSportyBetProvider implements SportyBetProvider {
  readonly name = 'SportyBet' as const;
  readonly client: SportyBetClient;
  private readonly catalog: SportyBetFixtureCatalog;

  constructor(options: SportyBetClientOptions = {}) {
    this.client = new SportyBetClient(options);
    this.catalog = new SportyBetFixtureCatalog(options);
  }

  listEvents(sport: 'football' | 'basketball'): Promise<SportyBetEvent[]> {
    return this.catalog.listEvents(sport);
  }

  async findEvents(homeTeam: string, awayTeam: string): Promise<SportyBetEvent[]> {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetHome = normalize(homeTeam);
    const targetAway = normalize(awayTeam);
    const [football, basketball] = await Promise.all([
      this.listEvents('football'),
      this.listEvents('basketball'),
    ]);
    return [...football, ...basketball].filter(
      (event) =>
        normalize(event.homeTeam).includes(targetHome) &&
        normalize(event.awayTeam).includes(targetAway),
    );
  }

  getEvent(eventId: string): Promise<SportyBetEvent | null> {
    return this.client.getEvent(eventId);
  }

  getMarkets(eventId: string): Promise<NormalizedMarket[]> {
    return this.client.getMarkets(eventId);
  }

  async resolveBookingCode(code: string): Promise<ProviderSelection[]> {
    return (await this.client.getBookingCode(code)).selections;
  }

  async createBookingCode(selections: ProviderSelection[]): Promise<string> {
    return (await this.client.createBookingCode(selections)).code;
  }

  health(): Promise<{ ok: boolean; detail: string }> {
    return this.client.health();
  }
}

/** Safe default adapter used while the verified browser-facing provider is disabled. */
export class UnsupportedSportyBetProvider implements SportyBetProvider {
  readonly name = 'SportyBet' as const;
  listEvents(): Promise<SportyBetEvent[]> {
    return Promise.reject(
      new SportyBetCapabilityError('events', 'SportyBet event integration is not configured.'),
    );
  }
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
      new SportyBetCapabilityError('create-code', 'SportyBet booking-code creation is not available through a verified interface.'),
    );
  }
  health(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: false, detail: 'No verified provider adapter configured' });
  }
}
