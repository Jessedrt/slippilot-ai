import { describe, expect, it, vi } from 'vitest';
import { SportyBetFixtureCatalog } from '../src/sportybet/fixture-catalog.js';

function event(id: number, sportId: string, league: string) {
  return {
    eventId: `sr:match:${id}`,
    estimateStartTime: Date.now() + 3_600_000,
    status: 0,
    homeTeamName: `Home ${id}`,
    awayTeamName: `Away ${id}`,
    sport: { id: sportId, category: { tournament: { name: league } } },
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  return input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
}

describe('complete SportyBet fixture catalog', () => {
  it('paginates beyond 100 fixtures, retains real leagues, and deduplicates IDs', async () => {
    const requests: string[] = [];
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      requests.push(url.searchParams.get('pageNum') ?? '');
      const page = Number(url.searchParams.get('pageNum'));
      const events = page === 1
        ? Array.from({ length: 100 }, (_, index) => event(index + 1, 'sr:sport:1', 'Premier League'))
        : [event(100, 'sr:sport:1', 'Premier League'), event(101, 'sr:sport:1', 'La Liga')];
      return Promise.resolve(new Response(JSON.stringify({ bizCode: 10000, data: {
        totalNum: 102, tournaments: [{ events }],
      } }), { status: 200 }));
    });
    const catalog = new SportyBetFixtureCatalog({ fetch: request });
    const fixtures = await catalog.listEvents('football');
    expect(requests).toEqual(['1', '2']);
    expect(fixtures).toHaveLength(101);
    expect(fixtures.find((fixture) => fixture.providerEventId === 'sr:match:101')?.league).toBe('La Liga');
    await catalog.listEvents('football');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("requests basketball's sport and market IDs independently", async () => {
    const urls: URL[] = [];
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ bizCode: 10000, data: {
        totalNum: 1, tournaments: [{ events: [event(8, 'sr:sport:2', 'EuroLeague')] }],
      } }), { status: 200 }));
    });
    const catalog = new SportyBetFixtureCatalog({ fetch: request });
    const fixtures = await catalog.listEvents('basketball');
    expect(urls[0]?.searchParams.get('sportId')).toBe('sr:sport:2');
    expect(urls[0]?.searchParams.get('marketId')).toBe('219');
    expect(fixtures[0]?.league).toBe('EuroLeague');
  });

  it('fails closed if a later fixture page cannot be retrieved', async () => {
    const request = vi.fn<typeof fetch>((input) => {
      const page = Number(requestUrl(input).searchParams.get('pageNum'));
      return Promise.resolve(new Response(page === 1
        ? JSON.stringify({ bizCode: 10000, data: { totalNum: 150, tournaments: [{ events: [event(1, 'sr:sport:1', 'League A')] }] } })
        : JSON.stringify({ bizCode: 10000, data: { totalNum: 150, tournaments: [] } }),
      { status: 200 }));
    });
    const catalog = new SportyBetFixtureCatalog({ fetch: request });
    await expect(catalog.listEvents('football')).rejects.toThrow(/incomplete/i);
  });
});
