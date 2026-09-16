import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLiveSlipSnapshot, chooseVariedMarket, marketFamily } from '../src/sportybet/discovery.js';
import type { NormalizedMarket } from '../src/types/domain.js';
import type { SportyBetProvider } from '../src/sportybet/contracts.js';

const makeMarket = (eventId: string, name: string, pick: string, id: string): NormalizedMarket => ({
  eventId,
  providerMarketId: id,
  providerSelectionId: `${id}-${eventId}`,
  sport: 'basketball',
  category: 'Main',
  marketName: name,
  selectionName: pick,
  odds: 1.6,
  status: 'active',
  lastUpdated: new Date(),
});

const markets = (id: string): NormalizedMarket[] => [
  makeMarket(id, 'Over/Under (incl. overtime)', 'Over 165.5', '225'),
  makeMarket(id, 'Winner (incl. overtime)', 'Home', '219'),
  makeMarket(id, 'Handicap (incl. overtime)', 'Away +4.5', '223'),
  makeMarket(id, 'Home team over/under (incl. overtime)', 'Under 80.5', '227'),
];

describe('mini app basketball variety', () => {
  it('recognizes distinct winner, handicap, game and team total families', () => {
    expect(new Set(markets('one').map(marketFamily)).size).toBe(4);
  });

  it('selects multiple real market families rather than repeating Over on every event', async () => {
    const fixtures = Array.from({ length: 5 }, (_, index) => ({
      providerEventId: `sr:match:${index + 1}`,
      homeTeam: `Home ${index + 1}`,
      awayTeam: `Away ${index + 1}`,
      startsAt: new Date(Date.now() + 3_600_000),
      status: 'scheduled' as const,
    }));
    const provider = {
      name: 'SportyBet',
      listEvents: async () => fixtures,
      getMarkets: async (id: string) => markets(id),
      findEvents: async () => [],
      getEvent: async () => null,
      resolveBookingCode: async () => [],
      createBookingCode: async () => 'TEST123',
      health: async () => ({ ok: true, detail: 'test' }),
    } as SportyBetProvider;
    const slip = await buildLiveSlipSnapshot(provider, 'basketball', 5, 10);
    expect(slip.slip.selections).toHaveLength(5);
    expect(new Set(slip.slip.selections.map((selection) => selection.eventId)).size).toBe(5);
    expect(new Set(slip.slip.selections.map(marketFamily)).size).toBeGreaterThanOrEqual(3);
    expect(slip.slip.selections.every((selection) => selection.status === 'active')).toBe(true);
  });

  it('never invents alternative markets when only one active market exists', () => {
    const only = [makeMarket('one', 'Over/Under (incl. overtime)', 'Over 165.5', '225')];
    expect(chooseVariedMarket(only, 1.6, new Map([['game-total', 4]]), new Map([['over', 4]])))
      .toBe(only[0]);
  });
});

describe('mini app form regression', () => {
  const html = readFileSync(new URL('../public/app/index.html', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../public/app/miniapp-controls.js', import.meta.url), 'utf8');
  it('provides a custom game count and supports integer odds on iOS', () => {
    expect(html).toContain('id="custom-count"');
    expect(html).toContain('id="custom-count-button"');
    expect(html).toMatch(/id="target-odds"[^>]*type="text"[^>]*inputmode="decimal"/);
    expect(html).toContain('miniapp-controls.js');
    expect(controls).toContain('Number(raw) < 1.01');
    expect(controls).toContain('customButton.dataset.count = value');
  });
});
