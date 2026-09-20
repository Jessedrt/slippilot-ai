import { describe, expect, it } from 'vitest';
import { SportyBetClient } from '../src/sportybet/SportyBetClient.js';

const market = (overrides: Record<string, unknown> = {}) => ({
  id: '18',
  product: 3,
  desc: 'Total',
  name: 'Over/Under',
  group: 'Goals',
  status: 0,
  specifier: 'total=2.5',
  outcomes: [{ id: '12', odds: '1.91', isActive: 1, desc: 'Over 2.5' }],
  lastOddsChangeTime: 1_789_470_000_000,
  ...overrides,
});

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'sr:match:12345',
  gameId: '98765',
  estimateStartTime: 1_899_000_000_000,
  status: 0,
  matchStatus: 'Not start',
  homeTeamName: 'Arsenal',
  awayTeamName: 'Chelsea',
  bookingStatus: 'Booked',
  sport: {
    id: 'sr:sport:1',
    name: 'Football',
    category: { name: 'England', tournament: { name: 'Premier League' } },
  },
  markets: [market()],
  ...overrides,
});

const ok = (data: unknown) =>
  new Response(JSON.stringify({ bizCode: 10000, message: 'Success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const mockedClient = (responses: Array<Response | (() => Promise<Response>)>, extra = {}) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    calls.push({ url, ...(init ? { init } : {}) });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected fetch');
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return {
    client: new SportyBetClient({
      fetch: fetchMock,
      minIntervalMs: 0,
      maxRetries: 0,
      cacheTtlMs: 1,
      ...extra,
    }),
    calls,
  };
};

const bodyText = (body: BodyInit | null | undefined): string => {
  if (typeof body !== 'string') throw new Error('Expected JSON string request body');
  return body;
};

describe('SportyBetClient', () => {
  it('parses nested football fixtures', async () => {
    const { client } = mockedClient([ok([{ events: [event()] }])]);
    const fixtures = await client.fetchFixtures('football');
    expect(fixtures[0]).toMatchObject({
      providerEventId: 'sr:match:12345',
      displayEventId: '98765',
      homeTeam: 'Arsenal',
      status: 'scheduled',
    });
  });

  it('requests the verified dynamic basketball sport ID', async () => {
    const basketball = event({
      sport: {
        id: 'sr:sport:2',
        name: 'Basketball',
        category: { name: 'USA', tournament: { name: 'NBA' } },
      },
    });
    const { client, calls } = mockedClient([ok([basketball])]);
    await client.fetchFixtures('basketball');
    expect(calls[0]?.url).toContain('sportId=sr%3Asport%3A2');
  });

  it('normalizes deep markets and preserves specifiers and lines', async () => {
    const { client } = mockedClient([ok(event())]);
    const markets = await client.getMarkets('sr:match:12345');
    expect(markets[0]).toMatchObject({
      providerMarketId: '18',
      providerSelectionId: '12',
      category: 'Goals',
      odds: 1.91,
      line: 2.5,
      specifier: 'total=2.5',
      status: 'active',
    });
  });

  it('normalizes basketball winner markets', async () => {
    const basketball = event({
      sport: { id: 'sr:sport:2', name: 'Basketball' },
      markets: [market({ id: '219', name: 'Winner (incl. overtime)', specifier: null })],
    });
    const { client } = mockedClient([ok(basketball)]);
    expect((await client.getMarkets('sr:match:12345'))[0]).toMatchObject({
      sport: 'basketball',
      marketName: 'Winner (incl. overtime)',
    });
  });

  it('marks suspended outcomes instead of dropping them', async () => {
    const suspended = event({
      markets: [market({ outcomes: [{ id: '12', odds: '1.91', isActive: 0, desc: 'Over' }] })],
    });
    const { client } = mockedClient([ok(suspended)]);
    expect((await client.getMarkets('sr:match:12345'))[0]?.status).toBe('suspended');
  });

  it('refreshes odds with the exact tuple payload', async () => {
    const { client, calls } = mockedClient([ok([event()])]);
    const refreshed = await client.refreshSelections([
      { eventId: 'sr:match:12345', marketId: '18', selectionId: '12', odds: 1.8, specifier: 'total=2.5' },
    ]);
    expect(refreshed[0]?.odds).toBe(1.91);
    expect(JSON.parse(bodyText(calls[0]?.init?.body)) as unknown).toEqual([
      { eventId: 'sr:match:12345', marketId: '18', outcomeId: '12', specifier: 'total=2.5' },
    ]);
  });

  it('validates, refreshes, and creates a code without retrying POST', async () => {
    const { client, calls } = mockedClient([
      ok(event()),
      ok([event()]),
      ok({ shareCode: 'ABC123', shareURL: 'https://www.sportybet.com/ng/share/ABC123' }),
    ]);
    const result = await client.createBookingCode([
      { eventId: 'sr:match:12345', marketId: '18', selectionId: '12', odds: 1.8, specifier: 'total=2.5' },
    ]);
    expect(result).toMatchObject({ code: 'ABC123', currentOdds: 1.91 });
    const request = JSON.parse(bodyText(calls[2]?.init?.body)) as {
      selections: Array<Record<string, unknown>>;
    };
    expect(request.selections[0]).toEqual({
      eventId: 'sr:match:12345', marketId: '18', outcomeId: '12', specifier: 'total=2.5',
    });
    expect(calls[2]?.init?.headers).toMatchObject({ OperId: '2' });
  });

  it('creates a code only if exact Outcomes confirms a market missing from event feed', async () => {
    const { client, calls } = mockedClient([
      ok(event({ markets: [] })),
      ok([event()]),
      ok([event()]),
      ok({ shareCode: 'VALID123' }),
    ]);
    const result = await client.createBookingCode([
      { eventId: 'sr:match:12345', marketId: '18', selectionId: '12', odds: 1.91, specifier: 'total=2.5' },
    ]);
    expect(result.code).toBe('VALID123');
    expect(calls).toHaveLength(4);
    expect(calls[1]?.url).toContain('/factsCenter/Outcomes');
    expect(calls[3]?.url).toContain('/orders/share');
  });

  it('rejects an expired event before share-code creation', async () => {
    const { client, calls } = mockedClient([ok(event({ status: 3, matchStatus: 'Ended' }))]);
    await expect(
      client.createBookingCode([
        { eventId: 'sr:match:12345', marketId: '18', selectionId: '12', odds: 1.91, specifier: 'total=2.5' },
      ]),
    ).rejects.toThrow('unavailable');
    expect(calls).toHaveLength(1);
  });

  it('rejects an incorrect specifier if exact Outcomes also cannot confirm it', async () => {
    const { client, calls } = mockedClient([ok(event()), ok([])]);
    await expect(
      client.createBookingCode([
        { eventId: 'sr:match:12345', marketId: '18', selectionId: '12', odds: 1.91, specifier: 'total=3.5' },
      ]),
    ).rejects.toThrow('SportyBet selection unavailable');
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !call.url.includes('/orders/share'))).toBe(true);
  });

  it('reads and normalizes an existing booking code', async () => {
    const { client } = mockedClient([
      ok({ shareCode: 'XYZ789', deadline: 1_899_000_000_000, outcomes: [event()], unavailableOutcomes: [] }),
    ]);
    const result = await client.getBookingCode('xyz789');
    expect(result).toMatchObject({ code: 'XYZ789', currentOdds: 1.91 });
    expect(result.selections[0]).toMatchObject({ tournament: 'Premier League', selectionName: 'Over 2.5' });
  });

  it('rejects malformed booking codes without an HTTP call', async () => {
    const { client, calls } = mockedClient([]);
    await expect(client.getBookingCode('../bad')).rejects.toThrow('Invalid');
    expect(calls).toHaveLength(0);
  });

  it.each([429, 500])('backs off and retries GET after HTTP %s', async (status) => {
    const sleeps: number[] = [];
    const { client, calls } = mockedClient(
      [new Response('', { status }), ok([])],
      { maxRetries: 1, sleep: (ms: number) => { sleeps.push(ms); return Promise.resolve(); } },
    );
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(typeof health.detail).toBe('string');
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(250);
  });

  it('does not retry a failed share-code POST', async () => {
    const { client, calls } = mockedClient(
      [ok(event()), ok([event()]), new Response('', { status: 500 }), ok({ shareCode: 'BAD' })],
      { maxRetries: 3 },
    );
    await expect(
      client.createBookingCode([
        { eventId: 'sr:match:12345', marketId: '18', selectionId: '12', odds: 1.91, specifier: 'total=2.5' },
      ]),
    ).rejects.toThrow('HTTP 500');
    expect(calls).toHaveLength(3);
  });

  it('aborts timed-out requests', async () => {
    const fetchMock = ((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Timed out', 'AbortError')),
        );
      })) as typeof fetch;
    const client = new SportyBetClient({ fetch: fetchMock, timeoutMs: 5, maxRetries: 0, minIntervalMs: 0 });
    await expect(client.getMarkets('sr:match:12345')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
