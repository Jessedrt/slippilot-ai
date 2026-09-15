import type { CandidateSelection } from '../types/domain.js';
import type { ProviderSelection, SportyBetProvider } from '../sportybet/contracts.js';
import { SportyBetEventMapper, SportyBetMarketMapper } from '../sportybet/mapper.js';

export type BookingPreparation =
  | { status: 'ready'; selections: ProviderSelection[]; previousOdds: number; currentOdds: number }
  | {
      status: 'odds_changed';
      selections: ProviderSelection[];
      previousOdds: number;
      currentOdds: number;
    }
  | { status: 'unavailable'; selection: CandidateSelection; reason: string };

export class SportyBetSlipBuilder {
  private readonly events = new SportyBetEventMapper();
  private readonly markets = new SportyBetMarketMapper();

  constructor(private readonly provider: SportyBetProvider) {}

  async prepare(
    selections: CandidateSelection[],
    materialChange = 0.05,
  ): Promise<BookingPreparation> {
    const resolved: ProviderSelection[] = [];
    for (const selection of selections) {
      const events = await this.provider.findEvents(
        selection.fixture.homeTeam,
        selection.fixture.awayTeam,
        selection.sport,
      );
      const event = this.events.match(selection, events);
      if (!event || event.status !== 'scheduled') {
        return { status: 'unavailable', selection, reason: 'Fixture missing or already started' };
      }
      const market = this.markets.match(
        selection,
        await this.provider.getMarkets(event.providerEventId),
      );
      if (!market)
        return { status: 'unavailable', selection, reason: 'Market unavailable or suspended' };
      resolved.push(this.markets.toProviderSelection(market));
    }
    const product = (values: number[]) => values.reduce((total, odds) => total * odds, 1);
    const previousOdds = product(selections.map((item) => item.odds));
    const currentOdds = product(resolved.map((item) => item.odds));
    const changed = Math.abs(currentOdds / previousOdds - 1) >= materialChange;
    return {
      status: changed ? 'odds_changed' : 'ready',
      selections: resolved,
      previousOdds: Math.round(previousOdds * 100) / 100,
      currentOdds: Math.round(currentOdds * 100) / 100,
    };
  }

  async createCode(preparation: BookingPreparation): Promise<string> {
    if (preparation.status !== 'ready')
      throw new Error('Booking preparation requires user review.');
    return this.provider.createBookingCode(preparation.selections);
  }
}
