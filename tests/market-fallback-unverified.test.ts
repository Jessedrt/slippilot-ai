import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLiveSlipSnapshot, MarketVerificationUnavailableError } from '../src/sportybet/discovery.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket } from '../src/types/domain.js';

afterEach(() => vi.useRealTimers());
describe('verified day fallback', () => {
  it("does not treat today's failed market feed as zero eligible matches or search tomorrow", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-18T10:00:00Z'));
    const events = [
      { providerEventId: 'today', homeTeam: 'A', awayTeam: 'B',
        startsAt: new Date('2026-09-18T18:00:00Z'), status: 'scheduled' as const },
      { providerEventId: 'tomorrow', homeTeam: 'C', awayTeam: 'D',
        startsAt: new Date('2026-09-19T18:00:00Z'), status: 'scheduled' as const },
    ];
    const getMarkets = vi.fn((id: string): Promise<NormalizedMarket[]> => id === 'today'
      ? Promise.reject(new Error('Supplier timed out')) : Promise.resolve([{
        eventId: id, providerMarketId: 'm', providerSelectionId: 's',
        sport: 'football', category: 'winner', marketName: 'Match winner',
        selectionName: 'Home', odds: 1.5, status: 'active', lastUpdated: new Date(),
      }]));
    const provider = {
      name: 'SportyBet', listEvents: () => Promise.resolve(events), getMarkets,
      getEvent: () => Promise.resolve(null), findEvents: () => Promise.resolve([]),
      resolveBookingCode: () => Promise.resolve([]),
      createBookingCode: () => Promise.resolve('TEST123'),
      health: () => Promise.resolve({ ok: true, detail: 'test' }),
    } as SportyBetProvider;
    await expect(buildLiveSlipSnapshot(provider, 'football', 3, 3))
      .rejects.toBeInstanceOf(MarketVerificationUnavailableError);
    expect(getMarkets).toHaveBeenCalledTimes(1);
    expect(getMarkets).toHaveBeenCalledWith('today');
  });
});
