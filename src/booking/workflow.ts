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
    const unavailable: Array<{ number: number; selection: CandidateSelection; reason: string }> = [];
    for (const [index, selection] of selections.entries()) {
      // Exact event IDs avoid accidentally resolving another match with similar names.
      const direct = await this.provider.getEvent(selection.eventId);
      const event = direct ?? this.events.match(selection, await this.provider.findEvents(
        selection.fixture.homeTeam, selection.fixture.awayTeam,
      ));
      if (!event || event.providerEventId !== selection.eventId || event.status !== 'scheduled') {
        unavailable.push({ number: index + 1, selection,
          reason: 'Fixture missing or already started' });
        continue;
      }
      const market = this.markets.match(selection,
        await this.provider.getMarkets(event.providerEventId));
      if (market) {
        resolved.push(this.markets.toProviderSelection(market));
        continue;
      }

      // The general event endpoint can omit a bookable market. Ask SportyBet's
      // exact Outcomes endpoint for this tuple; never guess an outcome by name.
      const requested: ProviderSelection = {
        eventId: selection.eventId, marketId: selection.providerMarketId,
        selectionId: selection.providerSelectionId, odds: selection.odds,
        ...(selection.specifier != null ? { specifier: selection.specifier } : {}),
      };
      let refreshed: ProviderSelection[] = [];
      if (this.provider.refreshSelections) {
        try {
          refreshed = await this.provider.refreshSelections([requested]);
        } catch (error) {
          // An absent exact outcome is a normal verification failure. Network,
          // rate-limit and provider errors must not be mislabelled as suspension.
          if (!(error instanceof Error && error.message.startsWith('SportyBet selection unavailable:')))
            throw error;
        }
      }
      const exact = refreshed.filter((item) => item.eventId === requested.eventId &&
        item.marketId === requested.marketId && item.selectionId === requested.selectionId &&
        (item.specifier ?? null) === (requested.specifier ?? null) &&
        Number.isFinite(item.odds) && item.odds > 1);
      if (exact.length === 1) {
        resolved.push(exact[0]!);
        continue;
      }
      unavailable.push({ number: index + 1, selection,
        reason: 'Exact market could not be verified for booking (not necessarily suspended)' });
    }
    if (unavailable.length) {
      const details = unavailable.map(({ number, selection, reason }) =>
        `#${number} ${selection.fixture.homeTeam} vs ${selection.fixture.awayTeam} (${selection.selectionName}): ${reason}`);
      return {
        status: 'unavailable', selection: unavailable[0]!.selection,
        reason: `${details.join('; ')}. Review or replace the unverified selections using their numbered rows, then tap Reanalyze before generating a new code. Your slip was not changed; no wager was placed.`,
      };
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
