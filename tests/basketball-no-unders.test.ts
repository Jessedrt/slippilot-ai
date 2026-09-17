import { describe, expect, it, vi } from 'vitest';
import {
  buildLiveSlipSnapshot,
  chooseVariedMarket,
  isBasketballUnderPick,
  NoTodayMarketsError,
} from '../src/sportybet/discovery.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';
import type { NormalizedMarket, Sport } from '../src/types/domain.js';

function market(eventId: string, selectionName: string, odds: number, sport: Sport = 'basketball'): NormalizedMarket {
  return {
    eventId,
    providerMarketId: `market-${eventId}-${selectionName}`,
    providerSelectionId: `pick-${eventId}-${selectionName}`,
    sport,
    category: 'totals',
    marketName: 'Over/Under (incl. overtime)',
    selectionName,
    odds,
    status: 'active',
    lastUpdated: new Date(),
  };
}

const emptyUsage = new Map<string, number>();

describe('basketball Under exclusion', () => {
  it('rejects Under and U shorthand, but not football Under or Over/Under market names', () => {
    expect(isBasketballUnderPick(market('1', 'Under 180.5', 1.8))).toBe(true);
    expect(isBasketballUnderPick(market('1', 'Home Under 80.5', 1.8))).toBe(true);
    expect(isBasketballUnderPick(market('1', 'U 180.5', 1.8))).toBe(true);
    expect(isBasketballUnderPick(market('1', 'Over 180.5', 1.8))).toBe(false);
    expect(isBasketballUnderPick(market('1', 'Thunder', 1.8))).toBe(false);
    expect(isBasketballUnderPick(market('1', 'Under 1.5', 1.8, 'football'))).toBe(false);
  });

  it('chooses another active basketball selection even when Under is closest to target odds', () => {
    const under = market('one', 'Under 170.5', 1.55);
    const over = market('one', 'Over 170.5', 1.8);
    expect(chooseVariedMarket([under, over], 1.55, emptyUsage, emptyUsage)).toBe(over);
    expect(chooseVariedMarket([under], 1.55, emptyUsage, emptyUsage)).toBeNull();
    expect(chooseVariedMarket([market('one', 'Under 1.5', 1.55, 'football')], 1.55, emptyUsage, emptyUsage)?.selectionName).toBe('Under 1.5');
  });

  it('skips Under-only fixtures rather than inserting them to meet an automatic game count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
    try {
      const fixtures = ['under-only', 'mixed'].map((id, index) => ({
        providerEventId: id,
        league: index ? 'League Two' : 'League One',
        homeTeam: `Home ${index}`,
        awayTeam: `Away ${index}`,
        startsAt: new Date(Date.now() + (index + 1) * 3_600_000),
        status: 'scheduled' as const,
      }));
      const provider = {
        listEvents: () => Promise.resolve(fixtures),
        getMarkets: (eventId: string) => Promise.resolve(eventId === 'under-only'
          ? [market(eventId, 'Under 165.5', 1.55)]
          : [market(eventId, 'Under 180.5', 1.55), market(eventId, 'Over 180.5', 1.7)]),
      } as unknown as SportyBetProvider;
      const result = await buildLiveSlipSnapshot(provider, 'basketball', 2, 3);
      expect(result.slip.selections).toHaveLength(1);
      expect(result.slip.selections[0]?.eventId).toBe('mixed');
      expect(result.slip.selections[0]?.selectionName).toBe('Over 180.5');
      const onlyUnders = {
        ...provider,
        listEvents: () => Promise.resolve(fixtures.slice(0, 1)),
      } as SportyBetProvider;
      await expect(buildLiveSlipSnapshot(onlyUnders, 'basketball', 2, 3))
        .rejects.toBeInstanceOf(NoTodayMarketsError);
    } finally {
      vi.useRealTimers();
    }
  });
});
