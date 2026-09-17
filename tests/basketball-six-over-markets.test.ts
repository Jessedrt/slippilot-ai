import { describe, expect, it, vi } from 'vitest';
import { buildLiveSlipSnapshot, chooseVariedMarket, isAllowedBasketballOverMarket, NoTodayMarketsError } from '../src/sportybet/discovery.js';
import type { NormalizedMarket, Sport } from '../src/types/domain.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

function market(name: string, selection: string, sport: Sport = 'basketball', odds = 1.6): NormalizedMarket {
  return {
    eventId: 'sr:match:101',
    providerMarketId: name,
    providerSelectionId: selection,
    sport,
    category: 'Main',
    marketName: name,
    selectionName: selection,
    odds,
    status: 'active',
    lastUpdated: new Date(),
  };
}

const allowed: Array<[string, string]> = [
  ['Over/Under (incl. overtime)', 'Over 165.5'],
  ['1st Half - Over/Under', 'Over 83.5'],
  ['Home team over/under (incl. overtime)', 'Over 80.5'],
  ['1st Half - Away Team Total', 'Over 40.5'],
  ['1st Quarter - Over/Under', 'Over 42.5'],
  ['1st Quarter - Home Team Total', 'Over 20.5'],
];

const rejected: Array<[string, string]> = [
  ['Over/Under (incl. overtime)', 'Under 165.5'],
  ['Winner (incl. overtime)', 'Home'],
  ['Handicap (incl. overtime)', 'Home -4.5'],
  ['1st Half - Winner', 'Away'],
  ['1st Quarter - Handicap', 'Home -2.5'],
  ['2nd Quarter - Over/Under', 'Over 43.5'],
  ['2nd Half - Home Team Total', 'Over 42.5'],
  ['Player Total Points', 'Over 20.5'],
  ['Both Teams To Score', 'Yes'],
  ['1st Quarter - Over/Under', 'Under 40.5'],
  ['Other Special', 'Over 165.5'],
];

const emptyUsage = new Map<string, number>();

describe('six-category basketball Over allowlist', () => {
  it.each(allowed)('allows %s — %s', (name, selection) => {
    expect(isAllowedBasketballOverMarket(market(name, selection))).toBe(true);
  });

  it.each(rejected)('excludes %s — %s', (name, selection) => {
    expect(isAllowedBasketballOverMarket(market(name, selection))).toBe(false);
  });

  it('recognizes alternate team, quarter and total labels without accepting unrelated picks', () => {
    expect(isAllowedBasketballOverMarket(market('First Half - Competitor 1 O/U', 'O 42.5'))).toBe(true);
    expect(isAllowedBasketballOverMarket(market('First Quarter - Away team total points', 'Over 19.5'))).toBe(true);
    expect(isAllowedBasketballOverMarket(market('Total Points', 'Over 162.5'))).toBe(true);
    expect(isAllowedBasketballOverMarket(market('First Half - Total', 'Over 80.5'))).toBe(true);
    expect(isAllowedBasketballOverMarket(market('Fourth Quarter - Total', 'Over 40.5'))).toBe(false);
  });

  it('never chooses a closer-priced winner, handicap, Under or second-quarter Over', () => {
    const forbidden = [
      market('Winner (incl. overtime)', 'Home', 'basketball', 1.55),
      market('Handicap (incl. overtime)', 'Home -4.5', 'basketball', 1.55),
      market('Over/Under (incl. overtime)', 'Under 165.5', 'basketball', 1.55),
      market('2nd Quarter - Over/Under', 'Over 42.5', 'basketball', 1.55),
    ];
    const valid = market('1st Quarter - Home Team Total', 'Over 20.5', 'basketball', 1.8);
    expect(chooseVariedMarket([...forbidden, valid], 1.55, emptyUsage, emptyUsage)).toBe(valid);
    expect(chooseVariedMarket(forbidden, 1.55, emptyUsage, emptyUsage)).toBeNull();
    expect(chooseVariedMarket([market('Winner', 'Home', 'football')], 1.55, emptyUsage, emptyUsage)?.selectionName).toBe('Home');
  });

  it('applies the filter across shared Telegram and Mini App live discovery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
    try {
      const fixture = {
        providerEventId: 'sr:match:101',
        homeTeam: 'Home', awayTeam: 'Away',
        startsAt: new Date(Date.now() + 3_600_000),
        status: 'scheduled' as const,
      };
      const valid = market('1st Half - Home Team Total', 'Over 39.5', 'basketball', 1.7);
      const provider = {
        listEvents: () => Promise.resolve([fixture]),
        getMarkets: () => Promise.resolve([...rejected.map(([name, selection]) => market(name, selection)), valid]),
      } as unknown as SportyBetProvider;
      const result = await buildLiveSlipSnapshot(provider, 'basketball', 5, 10);
      expect(result.slip.selections).toHaveLength(1);
      expect(result.slip.selections[0]?.selectionName).toBe('Over 39.5');
      expect(result.slip.selections[0]?.marketName).toBe('1st Half - Home Team Total');
      await expect(buildLiveSlipSnapshot({ ...provider, getMarkets: () => Promise.resolve(rejected.map(([name, selection]) => market(name, selection))) }, 'basketball', 5, 10)).rejects.toBeInstanceOf(NoTodayMarketsError);
    } finally {
      vi.useRealTimers();
    }
  });
});
