import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';
import type { ProviderSelection, SportyBetProvider } from '../src/sportybet/contracts.js';
import { buildReviewedLiveSlipSnapshot, MarketBookingUnavailableError,
  MarketReviewUnavailableError } from '../src/sportybet/market-review.js';
import type { NormalizedMarket } from '../src/types/domain.js';

const fixture = () => ({
  providerEventId: 'sr:match:12345', homeTeam: 'Home FC', awayTeam: 'Away FC',
  startsAt: new Date('2026-09-20T17:00:00Z'), status: 'scheduled' as const,
});
const market = (id: string, selectionName: string, odds: number): NormalizedMarket => ({
  eventId: fixture().providerEventId, providerMarketId: id,
  providerSelectionId: id === '45' ? '2-4' : '1',
  sport: 'football', category: 'Goals', marketName: id === '45' ? 'Goals range' : '1X2',
  selectionName, odds, status: 'active', lastUpdated: new Date(),
});
const markets = [market('45', '2-4', 1.34), market('1', 'Home', 1.42)];
const analyzer: SlipAnalyzer = {
  analyze: (candidates) => Promise.resolve({
    model: 'test', analyzedAt: new Date().toISOString(), summary: 'Compared both markets.',
    selections: candidates.map((candidate, index) => ({
      index: index + 1, confidence: candidate.selectionName === '2-4' ? 90 : 65,
      risk: 'medium' as const, verdict: 'keep' as const,
      reason: 'Reviewed, but not a guaranteed outcome.',
    })),
  }),
};
const createProvider = (refreshSelections: SportyBetProvider['refreshSelections']): SportyBetProvider => ({
  name: 'SportyBet', listEvents: () => Promise.resolve([fixture()]),
  findEvents: () => Promise.resolve([fixture()]),
  getEvent: () => Promise.resolve(fixture()),
  getMarkets: () => Promise.resolve(markets),
  ...(refreshSelections ? { refreshSelections } : {}),
  resolveBookingCode: () => Promise.resolve([]),
  createBookingCode: () => { throw new Error('A build must never create a booking code'); },
  health: () => Promise.resolve({ ok: true, detail: 'test' }),
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-20T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('bookability before slip presentation', () => {
  it('tries the next AI-reviewed alternative after the preferred exact outcome fails', async () => {
    const refresh = vi.fn((selections: ProviderSelection[]) => {
      if (selections[0]?.marketId === '45')
        return Promise.reject(new Error('SportyBet selection unavailable: exact tuple'));
      return Promise.resolve(selections.map((selection) => ({ ...selection, odds: 1.44 })));
    });
    const snapshot = await buildReviewedLiveSlipSnapshot(createProvider(refresh), analyzer,
      'football', 1, 1.4);
    expect(snapshot.slip.selections).toHaveLength(1);
    expect(snapshot.slip.selections[0]).toMatchObject({ providerMarketId: '1',
      selectionName: 'Home', odds: 1.44 });
    expect(snapshot.analysis.selections[0]?.confidence).toBe(65);
    expect(snapshot.combinedOdds).toBe(1.44);
    expect(snapshot.analysis.summary).toContain('1 exact outcomes confirmed for booking');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not show a slip if no analyzed outcome is confirmed bookable', async () => {
    const refresh = vi.fn(() => Promise.reject(
      new Error('SportyBet selection unavailable: exact tuple')));
    await expect(buildReviewedLiveSlipSnapshot(createProvider(refresh), analyzer,
      'football', 1)).rejects.toBeInstanceOf(MarketBookingUnavailableError);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not misclassify a provider outage as a suspended selection', async () => {
    const refresh = vi.fn(() => Promise.reject(new Error('SportyBet HTTP 503')));
    await expect(buildReviewedLiveSlipSnapshot(createProvider(refresh), analyzer,
      'football', 1)).rejects.toBeInstanceOf(MarketReviewUnavailableError);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never trusts a different outcome returned by the verification endpoint', async () => {
    const refresh = vi.fn((selections: ProviderSelection[]) => Promise.resolve(
      selections.map((selection) => ({ ...selection, selectionId: 'different' }))));
    await expect(buildReviewedLiveSlipSnapshot(createProvider(refresh), analyzer,
      'football', 1)).rejects.toBeInstanceOf(MarketBookingUnavailableError);
  });
});
