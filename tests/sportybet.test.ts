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
    const prepared = await new SportyBetSlipBuilder(new TestProvider(liveMarket(1.8))).prepare([
      candidate(1, 1.5),
    ]);
    expect(prepared).toMatchObject({ status: 'odds_changed', previousOdds: 1.5, currentOdds: 1.8 });
  });

  it('identifies the exact suspended market instead of returning a generic error', async () => {
    const prepared = await new SportyBetSlipBuilder(
      new TestProvider(liveMarket(1.5, false)),
    ).prepare([candidate(1, 1.5)]);
    expect(prepared).toMatchObject({ status: 'unavailable' });
    if (prepared.status !== 'unavailable') throw new Error('Expected an unavailable selection');
    expect(prepared.reason).toContain('#1 Home 1 vs Away 1');
    expect(prepared.reason).toContain('Market unavailable or suspended');
    expect(prepared.reason).toContain('tap Reanalyze');
  });

  it('checks the exact event directly even when the general listing omits it', async () => {
    class DirectProvider extends TestProvider {
      override getEvent(): Promise<SportyBetEvent> {
        return Promise.resolve({ providerEventId: 'event-1', homeTeam: 'Home 1 FC',
          awayTeam: 'Away 1', startsAt: new Date('2099-01-01'), status: 'scheduled' });
      }
      override findEvents(): Promise<SportyBetEvent[]> { throw new Error('Listing should not be queried'); }
    }
    const prepared = await new SportyBetSlipBuilder(new DirectProvider(liveMarket()))
      .prepare([candidate(1, 1.5)]);
    expect(prepared.status).toBe('ready');
  });

  it('reports every unavailable numbered selection without silently dropping picks', async () => {
    const prepared = await new SportyBetSlipBuilder(new TestProvider(liveMarket(1.5, false)))
      .prepare([candidate(1, 1.5), candidate(2, 1.6)]);
    expect(prepared.status).toBe('unavailable');
    if (prepared.status !== 'unavailable') throw new Error('Expected an unavailable slip');
    expect(prepared.reason).toContain('#1 Home 1 vs Away 1');
    expect(prepared.reason).toContain('#2 Home 2 vs Away 2');
    expect(prepared.reason).toContain('Remove the unavailable selections');
  });
});
