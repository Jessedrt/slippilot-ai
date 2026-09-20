import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import type { ProviderSelection, SportyBetEvent, SportyBetProvider } from '../src/sportybet/contracts.js';
import { buildReviewedLiveSlipSnapshot, MarketReviewUnavailableError } from '../src/sportybet/market-review.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const fixture = (index: number, hourUtc: number): SportyBetEvent => ({
  providerEventId: `sr:match:${index}`, homeTeam: `Home ${index}`,
  awayTeam: `Away ${index}`, startsAt: new Date(`2026-09-20T${String(hourUtc).padStart(2, '0')}:00:00Z`),
  status: 'scheduled', league: `League ${index % 4}`,
});
const market = (eventId: string, direction: string, odds = 1.6): NormalizedMarket => ({
  eventId, providerMarketId: '18', providerSelectionId: direction,
  sport: 'football', category: 'Total', marketName: 'Goals',
  selectionName: direction, odds, status: 'active', lastUpdated: new Date(),
});
const analyzer: SlipAnalyzer = { analyze: (candidates) => Promise.resolve({
  model: 'test', analyzedAt: new Date().toISOString(), summary: 'Evidence review.',
  selections: candidates.map((candidate, index) => ({ index: index + 1,
    confidence: candidate.selectionName === 'Under' ? 90 : 68,
    risk: 'lower' as const, verdict: 'keep' as const, reason: 'Test review.',
  })),
}) };
function source(events: SportyBetEvent[], markets: (id: string) => NormalizedMarket[]): SportyBetProvider {
  return {
    name: 'SportyBet', listEvents: () => Promise.resolve(events),
    findEvents: () => Promise.resolve(events),
    getEvent: (id) => Promise.resolve(events.find((item) => item.providerEventId === id) ?? null),
    getMarkets: (id) => Promise.resolve(markets(id)),
    resolveBookingCode: () => Promise.resolve([]),
    createBookingCode: () => Promise.resolve('TEST123'),
    health: () => Promise.resolve({ ok: true, detail: 'test' }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T08:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('booking-aware AI market selection', () => {
  it('tries another already-reviewed outcome for the same match when the favorite is not bookable', async () => {
    const game = fixture(1, 12);
    const provider: SportyBetProvider = {
      ...source([game], (id) => [market(id, 'Under'), market(id, 'Over')]),
      refreshSelections: (selections: ProviderSelection[]) => {
        if (selections[0]?.selectionId === 'Under') {
          return Promise.reject(new Error('SportyBet selection unavailable: exact outcome'));
        }
        return Promise.resolve(selections);
      },
    };
    const result = await buildReviewedLiveSlipSnapshot(provider, analyzer, 'football', 1, 1.6);
    expect(result.slip.selections).toHaveLength(1);
    expect(result.slip.selections[0]?.selectionName).toBe('Over');
    expect(result.analysis.selections[0]?.confidence).toBe(68);
    expect(result.analysis.summary).toContain('Verified 1 exact booking outcomes');
  });

  it('inspects later kickoff windows and avoids ten morning-only unbookable fixtures', async () => {
    const events = Array.from({ length: 20 }, (_item, index) => fixture(index + 1, index < 10 ? 9 : 21));
    const provider: SportyBetProvider = {
      ...source(events, (id) => [market(id, 'Home')]),
      refreshSelections: (selections: ProviderSelection[]) => {
        const id = Number(selections[0]?.eventId.split(':').at(-1));
        return id <= 10
          ? Promise.reject(new Error('SportyBet selection unavailable: exact outcome'))
          : Promise.resolve(selections);
      },
    };
    const result = await buildReviewedLiveSlipSnapshot(provider, analyzer, 'football', 10, 10);
    expect(result.slip.selections).toHaveLength(10);
    expect(result.slip.selections.every((selection) =>
      Number(selection.eventId.split(':').at(-1)) > 10)).toBe(true);
    expect(result.slip.selections.every((selection) => selection.fixture.startsAt.getUTCHours() === 21)).toBe(true);
  });

  it('reports provider outages instead of treating them as closed markets', async () => {
    const provider: SportyBetProvider = {
      ...source([fixture(1, 12)], (id) => [market(id, 'Home')]),
      refreshSelections: () => Promise.reject(new Error('SportyBet HTTP 503')),
    };
    await expect(buildReviewedLiveSlipSnapshot(provider, analyzer, 'football', 1))
      .rejects.toBeInstanceOf(MarketReviewUnavailableError);
  });

  it('does not silently use a materially different price without another analysis', async () => {
    const provider: SportyBetProvider = {
      ...source([fixture(1, 12)], (id) => [market(id, 'Home', 1.6)]),
      refreshSelections: (selections) => Promise.resolve(selections.map((item) => ({ ...item, odds: 2.2 }))),
    };
    await expect(buildReviewedLiveSlipSnapshot(provider, analyzer, 'football', 1))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});
