import { describe, expect, it } from 'vitest';
import { YouClient } from '../src/you/client.js';
import { normalizeSources, normalizeSportsResearch } from '../src/you/normalizer.js';
import { SportsResearchService } from '../src/research/sports-research.js';
import type { WebResearchProvider } from '../src/you/provider.js';

const searchPayload = {
  results: {
    web: [
      {
        url: 'https://www.bbc.com/sport/football/a',
        title: 'Team news',
        description: 'Player is fit to play.',
        snippets: ['Player is fit to play.'],
        page_age: '2026-09-15T10:00:00Z',
      },
    ],
    news: [],
  },
  metadata: { query: 'team news' },
};
const response = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const bodyText = (body: BodyInit | null | undefined): string => {
  if (typeof body !== 'string') throw new Error('Expected JSON request body');
  return body;
};

describe('YouClient', () => {
  it('sends Search to the official endpoint with X-API-Key and parses results', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = (input: URL | RequestInfo, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
      calls.push({ url, ...(init ? { init } : {}) });
      return Promise.resolve(response(searchPayload));
    };
    const result = await new YouClient({
      apiKey: 'secret-key',
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
    }).search('team news');
    expect(result.results.web[0]?.title).toBe('Team news');
    expect(calls[0]?.url).toBe('https://ydc-index.io/v1/search');
    expect(calls[0]?.init?.headers).toMatchObject({ 'X-API-Key': 'secret-key' });
    expect(JSON.parse(bodyText(calls[0]?.init?.body)) as unknown).toMatchObject({
      query: 'team news',
    });
  });

  it('parses Answer, Research, and Contents response shapes', async () => {
    const replies = [
      response({
        answer: 'Available [[1]]',
        citations: [{ source: 'https://nba.com/a', excerpts: ['Available'] }],
        results: { web: [] },
      }),
      response({ output: { content: 'Research summary', sources: searchPayload.results.web } }),
      response([
        {
          url: 'https://nba.com/a',
          title: 'NBA',
          markdown: '# Update',
          metadata: { site_name: 'NBA' },
        },
      ]),
    ];
    const client = new YouClient({
      apiKey: 'key-key-key',
      fetch: () => Promise.resolve(replies.shift() ?? response({})),
      sleep: () => Promise.resolve(),
    });
    expect((await client.answer('Who is available?')).answer).toContain('Available');
    expect((await client.research('Research availability')).output.sources).toHaveLength(1);
    expect((await client.getContents(['https://nba.com/a']))[0]?.markdown).toBe('# Update');
  });

  it('honors Retry-After for 429 and retries an idempotent request', async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = new YouClient({
      apiKey: 'key-key-key',
      fetch: () =>
        Promise.resolve(
          ++calls === 1 ? response({}, 429, { 'Retry-After': '1' }) : response(searchPayload),
        ),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect((await client.search('news')).results.web).toHaveLength(1);
    expect(calls).toBe(2);
    expect(waits).toContain(1000);
  });

  it('does not retry non-transient API errors', async () => {
    let calls = 0;
    const client = new YouClient({
      apiKey: 'key-key-key',
      fetch: () => {
        calls += 1;
        return Promise.resolve(response({}, 401));
      },
    });
    await expect(client.search('news')).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
  });

  it('rotates to the next configured API key when a key is rejected', async () => {
    const keys: string[] = [];
    const client = new YouClient({
      apiKey: 'first-key',
      apiKeys: ['second-key'],
      fetch: (_input, init) => {
        const key = (init?.headers as Record<string, string>)['X-API-Key']!;
        keys.push(key);
        return Promise.resolve(key === 'first-key' ? response({}, 401) : response(searchPayload));
      },
      sleep: () => Promise.resolve(),
    });
    expect((await client.search('rotation')).results.web).toHaveLength(1);
    expect(keys).toEqual(['first-key', 'second-key']);
  });

  it('aborts timed-out requests', async () => {
    const fetchMock = ((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Timed out', 'AbortError')),
        );
      })) as typeof fetch;
    const client = new YouClient({
      apiKey: 'key-key-key',
      fetch: fetchMock,
      timeoutMs: 5,
      sleep: () => Promise.resolve(),
    });
    await expect(client.search('news')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('uses cached normalized responses without a second API request', async () => {
    const store = new Map<string, unknown>();
    let calls = 0;
    const cache = {
      get: <T>(key: string) => Promise.resolve((store.get(key) as T | undefined) ?? null),
      set: <T>(key: string, value: T) => {
        store.set(key, value);
        return Promise.resolve();
      },
    };
    const client = new YouClient({
      apiKey: 'key-key-key',
      cache,
      fetch: () => {
        calls += 1;
        return Promise.resolve(response(searchPayload));
      },
    });
    await client.search('same query');
    await client.search('same query');
    expect(calls).toBe(1);
  });
});

describe('You.com research normalization', () => {
  it('returns an empty, low-confidence result for empty search results', () => {
    const result = normalizeSportsResearch('No result', [], 8, new Date('2026-09-15T12:00:00Z'));
    expect(result).toMatchObject({ sources: [], confidence: 0, freshness: 'unknown' });
  });

  it('deduplicates canonical URLs and syndicated snippets', () => {
    const items = [
      ...searchPayload.results.web,
      { ...searchPayload.results.web[0]!, url: 'https://bbc.com/sport/football/a?utm_source=x' },
      { ...searchPayload.results.web[0]!, url: 'https://example.com/copy' },
    ];
    expect(normalizeSources(items)).toHaveLength(1);
  });

  it('ranks trusted sports sources ahead of prediction sites', () => {
    const sources = normalizeSources([
      { url: 'https://spam-betting-tips.example/pick', title: 'Betting prediction', snippets: [] },
      ...searchPayload.results.web,
    ]);
    expect(sources[0]?.publisher).toBe('bbc.com');
    expect(sources[1]?.quality).toBe('low');
  });

  it('marks conflicting player availability and reduces confidence', () => {
    const items = [
      {
        url: 'https://nba.com/a',
        title: 'Official update',
        snippets: ['Player ruled out and unavailable.'],
        page_age: '2026-09-15T11:00:00Z',
      },
      {
        url: 'https://espn.com/b',
        title: 'Reporter update',
        snippets: ['Player is fit to play and available.'],
        page_age: '2026-09-15T11:00:00Z',
      },
    ];
    const result = normalizeSportsResearch(
      'Availability update.',
      items,
      8,
      new Date('2026-09-15T12:00:00Z'),
    );
    expect(result.conflicting).toBe(true);
    expect(result.summary).toContain('conflicts');
    expect(result.confidence).toBeLessThan(70);
  });

  it('falls back without blocking analysis when You.com is unavailable', async () => {
    const unavailable: WebResearchProvider = {
      search: () => Promise.reject(new Error('down')),
      answer: () => Promise.reject(new Error('down')),
      research: () => Promise.reject(new Error('down')),
      getContents: () => Promise.reject(new Error('down')),
    };
    const fixture = {
      id: '1',
      sport: 'football' as const,
      league: 'Premier League',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      startsAt: new Date(),
      status: 'scheduled' as const,
    };
    const result = await new SportsResearchService(unavailable).researchFixture(fixture, [
      'injury_uncertainty',
    ]);
    expect(result.status).toBe('unavailable');
    expect(result.summary).toContain('structured sports data');
  });

  it('skips You.com when no freshness trigger is present', async () => {
    let called = false;
    const provider: WebResearchProvider = {
      search: () => {
        called = true;
        return Promise.resolve(searchPayload);
      },
      answer: () => Promise.reject(new Error('unused')),
      research: () => Promise.reject(new Error('unused')),
      getContents: () => Promise.reject(new Error('unused')),
    };
    const fixture = {
      id: '1',
      sport: 'football' as const,
      league: 'Premier League',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      startsAt: new Date(),
      status: 'scheduled' as const,
    };
    expect((await new SportsResearchService(provider).researchFixture(fixture, [])).status).toBe(
      'skipped',
    );
    expect(called).toBe(false);
  });
});

