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
  ['Handicap (incl. overtime)', 'Home -4.5'],
  ['1st Half - Winner', 'Away'],
  ['1st Quarter - Handicap', 'Home -2.5'],
  ['2nd Quarter - Over/Under', 'Over 43.5'],
  ['2nd Half - Home Team Total', 'Under 42.5'],
  ['Player Total Points', 'Over 20.5'],
  ['4th Quarter - Over/Under', 'Under 38.5'],
  ['Both Teams To Score', 'Yes'],
  ['Other Special', 'Over 165.5'],
];

const unused = new Map<string, number>();

describe('basketball: all provider-verified markets', () => {
  it.each(categories)('does not ban %s — %s by market category or pick direction', (name, selection) => {
    const outcome = market(name, selection);
    expect(isAllowedBasketballOverMarket(outcome)).toBe(true);
    expect(chooseVariedMarket([outcome], 1.55, unused, unused)).toBe(outcome);
  });

  it('can select an Under, winner, spread, player prop or later-period line by target-price proximity', () => {
    const alternatives = categories.map(([name, selection], index) =>
      market(name, selection, 'basketball', index === 1 ? 1.55 : 1.8));
    expect(isBasketballUnderPick(alternatives[1]!)).toBe(true); // Detection is not a prohibition.
    expect(chooseVariedMarket(alternatives, 1.55, unused, unused)).toBe(alternatives[1]);
    expect(chooseVariedMarket([market('Winner', 'Home', 'football')], 1.55, unused, unused)?.selectionName)
      .toBe('Home');
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

  it('builds from Under-only and other formerly excluded fixtures without inventing selections', async () => {
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
      const perFixture = new Map(fixtures.map((fixture, index) => [
        fixture.providerEventId,
        [market(categories[index]![0], categories[index]![1], 'basketball', 1.55, 'active', fixture.providerEventId)],
      ]));
      const provider = {
        listEvents: () => Promise.resolve(fixtures),
        getMarkets: (id: string) => Promise.resolve(perFixture.get(id) ?? []),
      } as unknown as SportyBetProvider;
      const result = await buildLiveSlipSnapshot(provider, 'basketball', 4, 6);
      expect(result.slip.selections).toHaveLength(4);
      expect(new Set(result.slip.selections.map((selection) => selection.eventId)).size).toBe(4);
      expect(result.slip.selections.map((selection) => selection.selectionName))
        .toEqual(expect.arrayContaining(['Under 165.5', 'Home', 'Home -4.5']));

      const underOnly = {
        ...provider,
        listEvents: () => Promise.resolve(fixtures.slice(1, 2)),
      } as SportyBetProvider;
      const under = await buildLiveSlipSnapshot(underOnly, 'basketball', 2, 3);
      expect(under.slip.selections.map((selection) => selection.selectionName)).toEqual(['Under 165.5']);

      const suspendedOnly = {
        ...underOnly,
        getMarkets: () => Promise.resolve([market('Total', 'Under 165.5', 'basketball', 1.55, 'suspended')]),
      } as SportyBetProvider;
      await expect(buildLiveSlipSnapshot(suspendedOnly, 'basketball', 2, 3))
        .rejects.toBeInstanceOf(NoTodayMarketsError);
    } finally {
      vi.useRealTimers();
    }
  });
});
