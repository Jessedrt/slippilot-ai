import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const resolveMock = vi
    .fn<SportyBetProvider['resolveBookingCode']>()
    .mockResolvedValue([
      { eventId: event.providerEventId, marketId: '1', selectionId: '12', odds: 1.38 },
    ]);
  const getMarketsMock = vi.fn<SportyBetProvider['getMarkets']>().mockResolvedValue([market]);
  const sportyBet = {
    resolveBookingCode: resolveMock,
    getEvent: vi.fn<SportyBetProvider['getEvent']>().mockResolvedValue(event),
    getMarkets: getMarketsMock,
  } as unknown as SportyBetProvider;
  const analyze = vi.fn<SlipAnalyzer['analyze']>((selections) =>
    Promise.resolve({
      model: 'test-research',
      analyzedAt: '2026-09-18T17:00:00Z',
      summary: 'Market reviewed with limited evidence.',
      selections: selections.map((_pick, index) => ({
        index: index + 1,
        confidence: 55,
        risk: 'medium' as const,
        verdict: 'caution' as const,
        reason: 'Lineups have not been independently verified.',
      })),
    }),
  );
  return { sportyBet, slipAnalyzer: { analyze }, analyze, getMarketsMock, resolveMock };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('booking code analysis', () => {
  it('resolves every selection, calls AI, and returns real per-selection reasons', async () => {
    const services = deps();
    const result = await analyzeBookingCode('ABCD1234', services);
    expect(services.analyze).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      code: 'ABCD1234',
      count: 1,
      combinedOdds: 1.42,
      summary: 'Market reviewed with limited evidence.',
      selections: [
        {
          homeTeam: 'Home FC',
          awayTeam: 'Away FC',
          marketName: 'Total Goals',
          selectionName: 'Over 1.5',
          odds: 1.42,
          confidence: 55,
          verdict: 'caution',
          reason: 'Lineups have not been independently verified.',
        },
      ],
    });
  });

  it('does not pretend to analyze a code when a market is missing', async () => {
    const services = deps();
    services.getMarketsMock.mockResolvedValueOnce([]);
    await expect(analyzeBookingCode('ABCD1234', services)).rejects.toThrow('unique live market');
    expect(services.analyze).not.toHaveBeenCalled();
  });

  it('rejects suspended outcomes and exact-specifier mismatches', async () => {
    const suspended = deps();
    suspended.getMarketsMock.mockResolvedValueOnce([{ ...market, status: 'suspended' }]);
    await expect(analyzeBookingCode('ABCD1234', suspended)).rejects.toThrow('unique live market');
    const mismatched = deps();
    mismatched.resolveMock.mockResolvedValueOnce([
      {
        eventId: event.providerEventId,
        marketId: '1',
        selectionId: '12',
        odds: 1.38,
        specifier: 'total=2.5',
      },
    ]);
    await expect(analyzeBookingCode('ABCD1234', mismatched)).rejects.toThrow('unique live market');
  });

  it('does not send an empty code to AI', async () => {
    const services = deps();
    services.resolveMock.mockResolvedValueOnce([]);
    await expect(analyzeBookingCode('ABCD1234', services)).rejects.toThrow('no selections');
    expect(services.analyze).not.toHaveBeenCalled();
  });
});
