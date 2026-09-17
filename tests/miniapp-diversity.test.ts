import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildLiveSlipSnapshot, chooseVariedMarket, isAllowedBasketballOverMarket, marketFamily } from '../src/sportybet/discovery.js';
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
  makeMarket(id, '1st Half - Over/Under', 'Over 85.5', '226'),
  makeMarket(id, 'Home team over/under (incl. overtime)', 'Over 80.5', '227'),
  makeMarket(id, '1st Half - Away Team Total', 'Over 39.5', '228'),
  makeMarket(id, '1st Quarter - Over/Under', 'Over 40.5', '229'),
  makeMarket(id, '1st Quarter - Home Team Total', 'Over 19.5', '230'),
];

describe('mini app basketball Over variety', () => {
  it('recognizes the allowed game, team and period Over market families', () => {
    expect(markets('one').every(isAllowedBasketballOverMarket)).toBe(true);
    expect(new Set(markets('one').map(marketFamily)).size).toBe(3);
  });

  it('selects multiple allowed real Over market families rather than repeating one market', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T10:00:00Z'));
    try {
      const fixtures = Array.from({ length: 5 }, (_, index) => ({
        providerEventId: `sr:match:${index + 1}`,
        homeTeam: `Home ${index + 1}`,
        awayTeam: `Away ${index + 1}`,
        startsAt: new Date(Date.now() + 3_600_000),
        status: 'scheduled' as const,
      }));
      const provider = {
        name: 'SportyBet',
        listEvents: () => Promise.resolve(fixtures),
        getMarkets: (id: string) => Promise.resolve(markets(id)),
        findEvents: () => Promise.resolve([]),
        getEvent: () => Promise.resolve(null),
        resolveBookingCode: () => Promise.resolve([]),
        createBookingCode: () => Promise.resolve('TEST123'),
        health: () => Promise.resolve({ ok: true, detail: 'test' }),
      } as SportyBetProvider;
      const slip = await buildLiveSlipSnapshot(provider, 'basketball', 5, 10);
      expect(slip.slip.selections).toHaveLength(5);
      expect(new Set(slip.slip.selections.map((selection) => selection.eventId)).size).toBe(5);
      expect(new Set(slip.slip.selections.map(marketFamily)).size).toBeGreaterThanOrEqual(3);
      expect(slip.slip.selections.every((selection) => selection.status === 'active' && isAllowedBasketballOverMarket(selection))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never invents alternative markets when only one allowed active Over market exists', () => {
    const only = [makeMarket('one', 'Over/Under (incl. overtime)', 'Over 165.5', '225')];
    expect(chooseVariedMarket(only, 1.6, new Map([['game-total', 4]]), new Map([['over', 4]])))
      .toBe(only[0]);
  });
});

describe('mini app odds-first form regression', () => {
  const html = readFileSync(new URL('../public/app/index.html', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../public/app/miniapp-controls.js', import.meta.url), 'utf8');
  it('asks only for sport, required target odds and risk, not a visible game count', () => {
    expect(html).toMatch(/id="target-odds"[^>]*type="text"[^>]*inputmode="decimal"[^>]*required/);
    expect(html).toContain('id="estimated-games"');
    expect(html).not.toContain('id="custom-count"');
    expect(html).not.toMatch(/<legend>Games<\/legend>/);
    expect(html).toMatch(/class="chips hidden" id="count-chips"/);
    expect(html).toContain('miniapp-controls.js?v=3.0.4');
  });
  it('validates decimal odds and previews the bot-equivalent planning heuristic', () => {
    expect(controls).toContain('Number(raw) >= 1.01');
    expect(controls).toContain('Math.log(odds) / Math.log(desired)');
    expect(controls).toContain('About ${count}');
    expect(controls).not.toContain('customButton');
  });
});
