import { describe, expect, it, vi } from 'vitest';
import { analyzeBookingCode } from '../src/api/booking-code-analysis.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { SlipAnalyzer } from '../src/ai/slip-analyzer.js';

const event = {
  providerEventId: 'sr:match:123',
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  league: 'Test League',
  startsAt: new Date('2026-09-20T12:00:00Z'),
  status: 'scheduled' as const,
};
const market = {
  eventId: event.providerEventId,
  providerMarketId: '1',
  providerSelectionId: '12',
  sport: 'football' as const,
  category: 'goals',
  marketName: 'Total Goals',
  selectionName: 'Over 1.5',
  odds: 1.42,
  status: 'active' as const,
  lastUpdated: new Date(),
};

function deps() {
  const sportyBet = {
    resolveBookingCode: vi.fn().mockResolvedValue([{
      eventId: event.providerEventId, marketId: '1', selectionId: '12', odds: 1.38,
    }]),
    getEvent: vi.fn().mockResolvedValue(event),
    getMarkets: vi.fn().mockResolvedValue([market]),
  } as unknown as SportyBetProvider;
  const analyze = vi.fn(async (selections) => ({
    model: 'test-research',
    analyzedAt: '2026-09-18T17:00:00Z',
    summary: 'Market reviewed with limited evidence.',
    selections: selections.map((_pick: unknown, index: number) => ({
      index: index + 1,
      confidence: 55,
      risk: 'medium' as const,
      verdict: 'caution' as const,
      reason: 'Lineups have not been independently verified.',
    })),
  }));
  return { sportyBet, slipAnalyzer: { analyze } as unknown as SlipAnalyzer, analyze };
}

describe('booking code analysis', () => {
  it('resolves every selection, calls AI, and returns real per-selection reasons', async () => {
    const services = deps();
    const result = await analyzeBookingCode('ABCD1234', services);
    expect(services.analyze).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      code: 'ABCD1234', count: 1, combinedOdds: 1.42,
      summary: 'Market reviewed with limited evidence.',
      selections: [{
        homeTeam: 'Home FC', awayTeam: 'Away FC',
        marketName: 'Total Goals', selectionName: 'Over 1.5',
        odds: 1.42, confidence: 55, verdict: 'caution',
        reason: 'Lineups have not been independently verified.',
      }],
    });
  });

  it('does not pretend to analyze a code when a market is missing', async () => {
    const services = deps();
    vi.mocked(services.sportyBet.getMarkets).mockResolvedValueOnce([]);
    await expect(analyzeBookingCode('ABCD1234', services)).rejects.toThrow('unique live market');
    expect(services.analyze).not.toHaveBeenCalled();
  });

  it('does not send an empty code to AI', async () => {
    const services = deps();
    vi.mocked(services.sportyBet.resolveBookingCode).mockResolvedValueOnce([]);
    await expect(analyzeBookingCode('ABCD1234', services)).rejects.toThrow('no selections');
    expect(services.analyze).not.toHaveBeenCalled();
  });
});
