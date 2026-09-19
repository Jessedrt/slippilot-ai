import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SportyBetFixtureCatalog } from '../src/sportybet/fixture-catalog.js';
import { SPORTYBET_SPORT_IDS, SPORTYBET_PRIMARY_MARKET_IDS } from '../src/sportybet/SportyBetClient.js';
import { sportyBetShareUrl } from '../src/booking/sportybet-share-link.js';

const cases = [
  { sport: 'tennis' as const, id: 'sr:sport:5', market: '186' },
  { sport: 'handball' as const, id: 'sr:sport:6', market: '1' },
];

describe('tennis and handball provider integration', () => {
  it.each(cases)('requests the independent $sport fixture feed', async ({ sport, id, market }) => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = new URL(input instanceof URL ? input : typeof input === 'string' ? input : input.url);
      expect(url.searchParams.get('sportId')).toBe(id);
      expect(url.searchParams.get('marketId')).toBe(market);
      return Promise.resolve(new Response(JSON.stringify({ bizCode: 10000, data: {
        totalNum: 1, tournaments: [{ events: [{
          eventId: 'sr:match:900', homeTeamName: 'Player / Team A',
          awayTeamName: 'Player / Team B', estimateStartTime: Date.now() + 7_200_000,
          status: 0, sport: { id, category: { tournament: { name: 'Verified fixture feed' } } },
        }] }],
      } }), { status: 200 }));
    });
    const catalog = new SportyBetFixtureCatalog({ fetch: fetcher });
    const fixtures = await catalog.listEvents(sport);
    expect(SPORTYBET_SPORT_IDS[sport]).toBe(id);
    expect(SPORTYBET_PRIMARY_MARKET_IDS[sport]).toBe(market);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.providerEventId).toBe('sr:match:900');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('never invents events when the provider reports an empty list', async () => {
    const catalog = new SportyBetFixtureCatalog({ fetch: vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ bizCode: 10000, data: {
        totalNum: 0, tournaments: [],
      } }), { status: 200 }))) });
    expect(await catalog.listEvents('tennis')).toEqual([]);
    expect(await catalog.listEvents('handball')).toEqual([]);
  });

  it('loads both sports before Explore initializes and supports the edited-code link', () => {
    const boot = readFileSync('public/app/code-analysis.js', 'utf8');
    const extension = readFileSync('public/app/sports-extension.js', 'utf8');
    expect(boot).toContain("import './sports-extension.js?v=5.5.0'");
    expect(extension).toContain("id: 'tennis'");
    expect(extension).toContain("id: 'handball'");
    expect(extension).toContain(".code-workspace-code");
  });
});

describe('SportyBet website and code loader links', () => {
  it('labels website navigation accurately and offers the official loader separately', () => {
    expect(sportyBetShareUrl('a1bc9')).toBe('https://www.sportybet.com/?shareCode=A1BC9');
    expect(sportyBetShareUrl('not a code')).toBeNull();
    const controls = readFileSync('public/app/miniapp-controls.js', 'utf8');
    expect(controls).toContain('https://www.sportybet.com/?shareCode=');
    expect(controls).toContain('https://sporty.bet/Load-Booking-Code');
    expect(controls).toContain("appLink.target = '_blank'");
    expect(controls).toContain("webLink.target = '_blank'");
    expect(controls).toContain("webLink.rel = 'noopener noreferrer'");
    expect(controls).toContain('If iOS opens a browser');
    expect(controls.split('// A normal shareCode URL opens SportyBet')[1]).not.toContain('event.preventDefault()');
  });
});
