import type { NormalizedMarket, Sport } from '../types/domain.js';

export interface SportyBetEvent {
  providerEventId: string;
  displayEventId?: string;
  league?: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  status: 'scheduled' | 'live' | 'finished' | 'cancelled';
}

export interface ProviderSelection {
  eventId: string;
  marketId: string;
  selectionId: string;
  odds: number;
  specifier?: string | null;
}

export interface SportyBetProvider {
  readonly name: 'SportyBet';
  listEvents(sport: Sport): Promise<SportyBetEvent[]>;
  findEvents(homeTeam: string, awayTeam: string): Promise<SportyBetEvent[]>;
  getEvent(eventId: string): Promise<SportyBetEvent | null>;
  getMarkets(eventId: string): Promise<NormalizedMarket[]>;
  resolveBookingCode(code: string): Promise<ProviderSelection[]>;
  createBookingCode(selections: ProviderSelection[]): Promise<string>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

export class SportyBetCapabilityError extends Error {
  constructor(
    public readonly capability: 'events' | 'markets' | 'resolve-code' | 'create-code',
    message: string,
  ) {
    super(message);
    this.name = 'SportyBetCapabilityError';
  }
}
