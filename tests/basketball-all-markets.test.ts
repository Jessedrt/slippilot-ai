import { describe, expect, it, vi } from 'vitest';
import {
  buildLiveSlipSnapshot,
  chooseVariedMarket,
  isAllowedBasketballOverMarket,
  isBasketballUnderPick,
  NoTodayMarketsError,
} from '../src/sportybet/discovery.js';
import type { NormalizedMarket, Sport } from '../src/types/domain.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

function market(
  name: string,
  selection: string,
  sport: Sport = 'basketball',
  odds = 1.55,
  status: NormalizedMarket['status'] = 'active',
  eventId = 'sr:match:101',
): NormalizedMarket {
  return {
    eventId,
    providerMarketId: name,
    providerSelectionId: selection,
    sport,
    category: 'SportyBet market',
    marketName: name,
    selectionName: selection,
    odds,
    status,
    lastUpdated: new Date(),
  };
}

const categories: Array<[string, string]> = [
  ['Over/Under (incl. overtime)', 'Over 165.5'],
  ['Over/Under (incl. overtime)', 'Under 165.5'],
  ['Winner (incl. overtime)', 'Home'],
  ['1st Half - Winner', 'Away'],
  ['2nd Quarter - Over/Under', 'Over 43.5'],
  ['2nd Half - Home Team Total', 'Under 42.5'],
  ['Player Total Points', 'Over 20.5'],
  ['4th Quarter - Over/Under', 'Under 38.5'],
  ['Both Teams To Score', 'Yes'],
  ['Other Special', 'Over 165.5'],
];

const unused = new Map<string, number>();

describe('basketball: user preference excludes handicap, not other markets', () => {
  it.each(categories)('allows %s — %s', (name, selection) => {
    const outcome = market(name, selection);
    expect(isAllowedBasketballOverMarket(outcome)).toBe(true);
    expect(chooseVariedMarket([outcome], 1.55, unused, unused)).toBe(outcome);
  });

  it.each([
    ['Handicap (incl. overtime)', 'Home -4.5'],
    ['1st Quarter - Handicap', 'Home -2.5'],
    ['Point Spread', 'Away +7.5'],
    ['HCP', 'Home +1.5'],
  ])('excludes basketball %s — %s', (name, selection) => {
    const outcome = market(name, selection);
    expect(isAllowedBasketballOverMarket(outcome)).toBe(false);
    expect(chooseVariedMarket([outcome], 1.55, unused, unused)).toBeNull();
  });

  it('detects category-only spreads and leaves football handicap alone', () => {
    const categorySpread = { ...market('Alternate Line', 'Home'), category: 'Point Spread' };
    expect(isAllowedBasketballOverMarket(categorySpread)).toBe(false);
    expect(chooseVariedMarket([categorySpread], 1.55, unused, unused)).toBeNull();
    const footballHandicap = market('Handicap', 'Home -1', 'football');
    expect(chooseVariedMarket([footballHandicap], 1.55, unused, unused)).toBe(footballHandicap);
  });

  it('does not let target-price proximity decide basketball eligibility', () => {
    const alternatives = categories.map(([name, selection], index) =>
      market(name, selection, 'basketball', index === 1 ? 1.55 : 1.8),
    );
    expect(isBasketballUnderPick(alternatives[1]!)).toBe(true);
    const lowTarget = chooseVariedMarket(alternatives, 1.55, unused, unused);
    const highTarget = chooseVariedMarket(alternatives, 5, unused, unused);
    expect(lowTarget).toBe(highTarget);
    expect(lowTarget?.marketName).not.toMatch(/handicap|spread/i);
    expect(
      chooseVariedMarket([market('Winner', 'Home', 'football')], 1.55, unused, unused)
        ?.selectionName,
    ).toBe('Home');
  });

  it('still rejects suspended outcomes and invalid or nonfinite bookmaker odds for every sport', () => {
    const invalid = [
      market('Winner', 'Home', 'basketball', 1.55, 'suspended'),
      market('Total', 'Under 180', 'basketball', 1.0),
      market('Player points', 'Over 15', 'basketball', 1001),
      market('Handicap', 'Away', 'basketball', Number.NaN),
    ];
    expect(chooseVariedMarket(invalid, 1.55, unused, unused)).toBeNull();
    const valid = market('Winner', 'Home', 'basketball', 1.8);
    expect(chooseVariedMarket([...invalid, valid], 1.55, unused, unused)).toBe(valid);
  });

  it('builds from Under and other eligible fixtures without inventing handicap selections', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
    try {
      const fixtures = categories.slice(0, 4).map((_, index) => ({
        providerEventId: `sr:match:${index + 101}`,
        homeTeam: `Home ${index}`,
        awayTeam: `Away ${index}`,
        startsAt: new Date(Date.now() + (index + 1) * 3_600_000),
        status: 'scheduled' as const,
      }));
      const perFixture = new Map(
        fixtures.map((fixture, index) => [
          fixture.providerEventId,
          [
            market(
              categories[index]![0],
              categories[index]![1],
              'basketball',
              1.55,
              'active',
              fixture.providerEventId,
            ),
          ],
        ]),
      );
      const provider = {
        listEvents: () => Promise.resolve(fixtures),
        getMarkets: (id: string) => Promise.resolve(perFixture.get(id) ?? []),
      } as unknown as SportyBetProvider;
      const result = await buildLiveSlipSnapshot(provider, 'basketball', 4, 6);
      expect(result.slip.selections).toHaveLength(4);
      expect(new Set(result.slip.selections.map((selection) => selection.eventId)).size).toBe(4);
      expect(result.slip.selections.map((selection) => selection.selectionName)).toEqual(
        expect.arrayContaining(['Under 165.5', 'Home', 'Away']),
      );

      const underOnly = {
        ...provider,
        listEvents: () => Promise.resolve(fixtures.slice(1, 2)),
      } as SportyBetProvider;
      const under = await buildLiveSlipSnapshot(underOnly, 'basketball', 2, 3);
      expect(under.slip.selections.map((selection) => selection.selectionName)).toEqual([
        'Under 165.5',
      ]);

      const handicapOnly = {
        ...provider,
        getMarkets: () => Promise.resolve([market('Handicap', 'Home -4.5')]),
      } as SportyBetProvider;
      await expect(buildLiveSlipSnapshot(handicapOnly, 'basketball', 2, 3)).rejects.toBeInstanceOf(
        NoTodayMarketsError,
      );

      const suspendedOnly = {
        ...underOnly,
        getMarkets: () =>
          Promise.resolve([market('Total', 'Under 165.5', 'basketball', 1.55, 'suspended')]),
      } as SportyBetProvider;
      await expect(buildLiveSlipSnapshot(suspendedOnly, 'basketball', 2, 3)).rejects.toBeInstanceOf(
        NoTodayMarketsError,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
