import { describe, expect, it } from 'vitest';
import { SportyBetSlipBuilder } from '../src/booking/workflow.js';
import { MarketCatalog } from '../src/markets/catalog.js';
import type {
  ProviderSelection,
  SportyBetEvent,
  SportyBetProvider,
} from '../src/sportybet/contracts.js';
import { SportyBetEventMapper, SportyBetMarketMapper } from '../src/sportybet/mapper.js';
import type { NormalizedMarket } from '../src/types/domain.js';
import { candidate } from './fixtures.js';

class TestProvider implements SportyBetProvider {
  readonly name = 'SportyBet' as const;
  code = 'TEST123';
  constructor(public market: NormalizedMarket) {}
  listEvents(): Promise<SportyBetEvent[]> {
    return this.findEvents();
  }
  findEvents(): Promise<SportyBetEvent[]> {
    return Promise.resolve([
      {
        providerEventId: 'event-1',
        homeTeam: 'Home 1 FC',
        awayTeam: 'Away 1',
        startsAt: new Date('2026-09-16'),
        status: 'scheduled',
      },
    ]);
  }
  getEvent(): Promise<SportyBetEvent | null> {
    return Promise.resolve(null);
  }
  getMarkets(): Promise<NormalizedMarket[]> {
    return Promise.resolve([this.market]);
  }
  resolveBookingCode(): Promise<ProviderSelection[]> {
    return Promise.resolve([]);
  }
  createBookingCode(): Promise<string> {
    return Promise.resolve(this.code);
  }
  health(): Promise<{ ok: boolean; detail: 'test' }> {
    return Promise.resolve({ ok: true, detail: 'test' });
  }
}

const liveMarket = (odds = 1.5, active = true) =>
  new MarketCatalog().normalize({
    marketId: 'market-1',
    selectionId: 'selection-1',
    eventId: 'event-1',
    sport: 'football',
    marketName: 'Over/Under Goals',
    selectionName: 'Over 1.5',
    odds,
    active,
  });

describe('SportyBet mapping', () => {
  it('maps normalized team and market names', () => {
    const pick = candidate(1, 1.5);
    expect(
      new SportyBetEventMapper().match(pick, [
        {
          providerEventId: 'p1',
          homeTeam: 'Home 1 FC',
          awayTeam: 'Away 1',
          startsAt: new Date(),
          status: 'scheduled',
        },
      ])?.providerEventId,
    ).toBe('p1');
    expect(new SportyBetMarketMapper().match(pick, [liveMarket()])?.providerSelectionId).toBe(
      'selection-1',
    );
  });
});

describe('booking workflow', () => {
  it('refreshes odds and allows code creation when unchanged', async () => {
    const workflow = new SportyBetSlipBuilder(new TestProvider(liveMarket()));
    const prepared = await workflow.prepare([candidate(1, 1.5)]);
    expect(prepared.status).toBe('ready');
    await expect(workflow.createCode(prepared)).resolves.toBe('TEST123');
  });

  it('requires review after a material odds change', async () => {
    const workflow = new SportyBetSlipBuilder(new TestProvider(liveMarket(1.8)));
    const prepared = await workflow.prepare([candidate(1, 1.5)]);
    expect(prepared).toMatchObject({ status: 'odds_changed', previousOdds: 1.5, currentOdds: 1.8 });
    await expect(workflow.createCode(prepared)).rejects.toThrow('requires user review');
    await expect(workflow.createCode(prepared, true)).resolves.toBe('TEST123');
  });

  it('rejects expired or unsupported analysis before contacting booking', async () => {
    const workflow = new SportyBetSlipBuilder(new TestProvider(liveMarket()));
    const expired = candidate(1, 1.5);
    expired.assessment = { ...expired.assessment!, expiresAt: new Date(0) };
    const expiredResult = await workflow.prepare([expired]);
    expect(expiredResult.status).toBe('unavailable');
    if (expiredResult.status !== 'unavailable') throw new Error('Expected expired analysis');
    expect(expiredResult.reason).toContain('Analysis expired');
    const unsupported = candidate(1, 1.5);
    unsupported.assessment = {
      ...unsupported.assessment!,
      statisticalSupport: 'insufficient',
      recommendationVerdict: 'reject',
    };
    const unsupportedResult = await workflow.prepare([unsupported]);
    expect(unsupportedResult.status).toBe('unavailable');
    if (unsupportedResult.status !== 'unavailable')
      throw new Error('Expected unsupported analysis');
    expect(unsupportedResult.reason).toContain('explicitly supported analysis');
  });

  it('identifies the exact market when neither verification source confirms it', async () => {
    const prepared = await new SportyBetSlipBuilder(
      new TestProvider(liveMarket(1.5, false)),
    ).prepare([candidate(1, 1.5)]);
    expect(prepared).toMatchObject({ status: 'unavailable' });
    if (prepared.status !== 'unavailable') throw new Error('Expected an unavailable selection');
    expect(prepared.reason).toContain('#1 Home 1 vs Away 1');
    expect(prepared.reason).toContain('could not be verified');
    expect(prepared.reason).toContain('tap Reanalyze');
  });

  it('checks the exact event directly even when the general listing omits it', async () => {
    class DirectProvider extends TestProvider {
      override getEvent(): Promise<SportyBetEvent> {
        return Promise.resolve({
          providerEventId: 'event-1',
          homeTeam: 'Home 1 FC',
          awayTeam: 'Away 1',
          startsAt: new Date('2099-01-01'),
          status: 'scheduled',
        });
      }
      override findEvents(): Promise<SportyBetEvent[]> {
        throw new Error('Listing should not be queried');
      }
    }
    const prepared = await new SportyBetSlipBuilder(new DirectProvider(liveMarket())).prepare([
      candidate(1, 1.5),
    ]);
    expect(prepared.status).toBe('ready');
  });

  it('reports every unavailable numbered selection without silently dropping picks', async () => {
    const prepared = await new SportyBetSlipBuilder(
      new TestProvider(liveMarket(1.5, false)),
    ).prepare([candidate(1, 1.5), candidate(2, 1.6)]);
    expect(prepared.status).toBe('unavailable');
    if (prepared.status !== 'unavailable') throw new Error('Expected an unavailable slip');
    expect(prepared.reason).toContain('#1 Home 1 vs Away 1');
    expect(prepared.reason).toContain('#2 Home 2 vs Away 2');
    expect(prepared.reason).toContain('Review or replace the unverified selections');
  });

  it('accepts an exact active outcome when the event market feed omits it', async () => {
    class PartialEventProvider extends TestProvider {
      override getMarkets(): Promise<NormalizedMarket[]> {
        return Promise.resolve([]);
      }
      refreshSelections(selections: ProviderSelection[]): Promise<ProviderSelection[]> {
        return Promise.resolve(selections.map((selection) => ({ ...selection, odds: 1.5 })));
      }
    }
    const prepared = await new SportyBetSlipBuilder(new PartialEventProvider(liveMarket())).prepare(
      [candidate(1, 1.5)],
    );
    expect(prepared).toMatchObject({ status: 'ready', currentOdds: 1.5 });
  });

  it('never silently substitutes a different outcome returned by the fallback', async () => {
    class WrongOutcomeProvider extends TestProvider {
      override getMarkets(): Promise<NormalizedMarket[]> {
        return Promise.resolve([]);
      }
      refreshSelections(selections: ProviderSelection[]): Promise<ProviderSelection[]> {
        return Promise.resolve(
          selections.map((selection) => ({ ...selection, selectionId: 'wrong' })),
        );
      }
    }
    const prepared = await new SportyBetSlipBuilder(new WrongOutcomeProvider(liveMarket())).prepare(
      [candidate(1, 1.5)],
    );
    expect(prepared.status).toBe('unavailable');
  });

  it('does not report provider outages as market suspension', async () => {
    class OfflineRefreshProvider extends TestProvider {
      override getMarkets(): Promise<NormalizedMarket[]> {
        return Promise.resolve([]);
      }
      refreshSelections(): Promise<ProviderSelection[]> {
        return Promise.reject(new Error('SportyBet HTTP 503'));
      }
    }
    await expect(
      new SportyBetSlipBuilder(new OfflineRefreshProvider(liveMarket())).prepare([
        candidate(1, 1.5),
      ]),
    ).rejects.toThrow('SportyBet HTTP 503');
  });
});
