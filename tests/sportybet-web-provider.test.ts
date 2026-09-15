import { afterEach, describe, expect, it, vi } from 'vitest';
import { SportyBetWebError, SportyBetWebProvider } from '../src/sportybet/web-provider.js';

const upcoming = {
  bizCode: 10000,
  data: {
    tournaments: [
      {
        name: 'Test League',
        categoryName: 'Test',
        events: [
          {
            eventId: 'sr:match:123',
            gameId: '99',
            homeTeamName: 'Home FC',
            awayTeamName: 'Away FC',
            estimateStartTime: Date.now() + 3_600_000,
            matchStatus: 'Not start',
            markets: [
              {
                id: '18',
                desc: 'Over/Under',
                specifier: 'total=2.5',
                status: 0,
                outcomes: [
                  { id: '12', desc: 'Over', odds: '1.55', isActive: 1 },
                  { id: '13', desc: 'Under', odds: '2.20', isActive: 0 },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

const booking = {
  bizCode: 10000,
  data: {
    shareCode: 'ABC123',
    shareURL: 'https://www.sportybet.com/ng/?shareCode=ABC123',
    outcomes: [
      {
        eventId: 'sr:match:123',
        markets: [
          {
            id: '18',
            desc: 'Over/Under',
            specifier: 'total=2.5',
            outcomes: [{ id: '12', desc: 'Over', odds: '1.55', isActive: 1 }],
          },
        ],
      },
    ],
    unavailableOutcomes: [],
  },
};

const config = {
  apiBaseUrl: 'https://www.sportybet.com',
  region: 'ng',
  timeoutMs: 2_000,
  minIntervalMs: 0,
  maxConcurrency: 4,
  maxRetries: 0,
  cacheTtlMs: 60_000,
  timelineHours: 720,
  pageSize: 100,
  maxPages: 1,
  footballMarketIds: ['1', '18'],
  basketballMarketIds: ['219', '223', '225'],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SportyBetWebProvider', () => {
  it('normalizes fixtures, market lines and suspended outcomes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(upcoming)));
    const provider = new SportyBetWebProvider(config);
    const events = await provider.findEvents('Home FC', 'Away FC', 'football');
    expect(events[0]).toMatchObject({ providerEventId: 'sr:match:123', status: 'scheduled' });
    const markets = await provider.getMarkets('sr:match:123');
    expect(markets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerMarketId: '18',
          providerSelectionId: '12',
          specifier: 'total=2.5',
          line: 2.5,
          status: 'active',
        }),
        expect.objectContaining({ providerSelectionId: '13', status: 'suspended' }),
      ]),
    );
  });

  it('creates the non-staking share payload and loads the code back', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/orders/share') && init?.method === 'POST') return jsonResponse(booking);
      if (url.endsWith('/orders/share/ABC123')) return jsonResponse(booking);
      if (url.includes('/factsCenter/pcUpcomingEvents')) return jsonResponse(upcoming);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SportyBetWebProvider(config);
    await provider.findEvents('Home FC', 'Away FC', 'football');
    const market = (await provider.getMarkets('sr:match:123')).find(
      (item) => item.providerSelectionId === '12',
    );
    expect(market).toBeDefined();
    const code = await provider.createBookingCode([
      {
        eventId: 'sr:match:123',
        marketId: '18',
        selectionId: '12',
        specifier: 'total=2.5',
        odds: 1.55,
      },
    ]);
    expect(code).toBe('ABC123');
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      selections: [
        {
          eventId: 'sr:match:123',
          marketId: '18',
          specifier: 'total=2.5',
          outcomeId: '12',
        },
      ],
    });
    await expect(provider.resolveBookingCode(code)).resolves.toEqual([
      {
        eventId: 'sr:match:123',
        marketId: '18',
        selectionId: '12',
        odds: 1.55,
        specifier: 'total=2.5',
      },
    ]);
  });

  it('never retries the booking POST after an upstream failure', async () => {
    let postCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/factsCenter/pcUpcomingEvents')) return jsonResponse(upcoming);
        if (url.endsWith('/orders/share') && init?.method === 'POST') {
          postCount += 1;
          return jsonResponse({ message: 'temporary failure' }, 500);
        }
        return jsonResponse({}, 404);
      }),
    );
    const provider = new SportyBetWebProvider({ ...config, maxRetries: 3 });
    await expect(
      provider.createBookingCode([
        {
          eventId: 'sr:match:123',
          marketId: '18',
          selectionId: '12',
          specifier: 'total=2.5',
          odds: 1.55,
        },
      ]),
    ).rejects.toBeInstanceOf(SportyBetWebError);
    expect(postCount).toBe(1);
  });
});
