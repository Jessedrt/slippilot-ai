import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leagueExclusionReason } from '../src/sportybet/league-quality.js';
import { buildLiveSlipSnapshot } from '../src/sportybet/discovery.js';
import type { SportyBetEvent, SportyBetProvider } from '../src/sportybet/contracts.js';
import type { Sport } from '../src/types/domain.js';

const event = (id: number, league: string, start: string): SportyBetEvent => ({
  providerEventId: `sr:match:${id}`, homeTeam: `Home ${id}`, awayTeam: `Away ${id}`,
  startsAt: new Date(start), status: 'scheduled', league,
});
function provider(fixtures: SportyBetEvent[], sport: Sport) {
  const getMarkets = vi.fn((eventId: string) => Promise.resolve([{
    eventId, providerMarketId: '18', providerSelectionId: 'home', sport,
    category: 'Result', marketName: 'Winner', selectionName: 'Home', odds: 1.5,
    status: 'active' as const, lastUpdated: new Date(),
  }]));
  const source: SportyBetProvider = {
    name: 'SportyBet', listEvents: () => Promise.resolve(fixtures),
    findEvents: () => Promise.resolve([]), getEvent: () => Promise.resolve(null),
    getMarkets, resolveBookingCode: () => Promise.resolve([]),
    createBookingCode: () => Promise.resolve('TEST123'),
    health: () => Promise.resolve({ ok: true, detail: 'test' }),
  };
  return { source, getMarkets };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T08:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('transparent pre-match league filter', () => {
  it('excludes youth, reserve, amateur, friendlies, lower tiers and simulated labels', () => {
    expect(leagueExclusionReason('football', 'Premier League U19')).toBe('Youth, reserve or developmental competition');
    expect(leagueExclusionReason('football', 'Reserve League')).toBe('Youth, reserve or developmental competition');
    expect(leagueExclusionReason('football', 'Club Friendlies')).toBe('Friendly or exhibition competition');
    expect(leagueExclusionReason('football', 'Regional Amateur Cup')).toBe('Regional, amateur or school competition');
    expect(leagueExclusionReason('football', 'Serie C')).toBe('Lower-tier competition');
    expect(leagueExclusionReason('basketball', 'NBA G League')).toBe('Lower-tier competition');
    expect(leagueExclusionReason('basketball', 'University League')).toBe('Regional, amateur or school competition');
    expect(leagueExclusionReason('basketball', 'Virtual Basketball')).toBe('Virtual or simulated competition');
  });

  it('keeps established and unidentified league labels without inventing a quality rating', () => {
    expect(leagueExclusionReason('football', 'Premier League')).toBeNull();
    expect(leagueExclusionReason('football', 'Women’s Super League')).toBeNull();
    expect(leagueExclusionReason('football', 'Serie B')).toBeNull();
    expect(leagueExclusionReason('basketball', 'NBA')).toBeNull();
    expect(leagueExclusionReason('basketball', 'NCAA Division I')).toBeNull();
    expect(leagueExclusionReason('football', undefined)).toBeNull();
    expect(leagueExclusionReason('tennis', 'Under 21 Development League')).toBeNull();
  });

  it.each(['football', 'basketball'] as const)(
    'removes excluded %s fixtures before allocating slots across morning and evening', async (sport) => {
      const excluded = sport === 'football' ? 'Youth U19 League' : 'NBA G League';
      const included = sport === 'football' ? 'Premier League' : 'NBA';
      const fixtures = [
        ...Array.from({ length: 10 }, (_, i) => event(i + 1, excluded, '2026-09-20T09:00:00Z')),
        ...Array.from({ length: 10 }, (_, i) => event(i + 11, included, '2026-09-20T21:00:00Z')),
      ];
      const { source, getMarkets } = provider(fixtures, sport);
      const result = await buildLiveSlipSnapshot(source, sport, 10, 20);
      expect(result.slip.selections).toHaveLength(10);
      expect(result.slip.selections.every((pick) => pick.fixture.league === included)).toBe(true);
      expect(getMarkets).toHaveBeenCalledTimes(10);
      expect(getMarkets.mock.calls.every(([id]) => Number(id.split(':').at(-1)) > 10)).toBe(true);
    },
  );

  it('falls forward only when the earlier day has no eligible fixtures after filtering', async () => {
    const { source } = provider([
      event(1, 'Reserve League', '2026-09-20T10:00:00Z'),
      event(2, 'NBA', '2026-09-21T10:00:00Z'),
    ], 'basketball');
    const result = await buildLiveSlipSnapshot(source, 'basketball', 1);
    expect(result.dayOffset).toBe(1);
    expect(result.slip.selections[0]?.eventId).toBe('sr:match:2');
  });

  it('reports when every listed competition was excluded instead of inventing picks', async () => {
    const { source, getMarkets } = provider([
      event(1, 'U21 League', '2026-09-20T10:00:00Z'),
      event(2, 'Amateur Cup', '2026-09-20T20:00:00Z'),
    ], 'football');
    await expect(buildLiveSlipSnapshot(source, 'football', 2))
      .rejects.toThrow('league filter excluded 2 fixtures');
    expect(getMarkets).not.toHaveBeenCalled();
  });
});
