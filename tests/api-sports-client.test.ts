import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ApiSportsClient,
  ApiSportsError,
  type ApiSportsRequestEvent,
} from '../src/api-sports/client.js';
import { basketballGameSchema, footballFixtureSchema } from '../src/api-sports/fixture-matcher.js';

const envelope = (
  response: unknown,
  errors: unknown = {},
  results = Array.isArray(response) ? response.length : 1,
) => ({
  get: 'fixtures',
  parameters: {},
  errors,
  results,
  paging: { current: 1, total: 1 },
  response,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const football = {
  fixture: {
    id: 1,
    date: '2026-09-22T18:00:00+00:00',
    timestamp: 1790100000,
    status: { short: 'NS' },
  },
  league: { id: 39, name: 'Premier League', season: 2026 },
  teams: { home: { id: 10, name: 'Home' }, away: { id: 20, name: 'Away' } },
  goals: { home: null, away: null },
};
const basketball = {
  id: 2,
  date: '2026-09-22T18:00:00+00:00',
  timestamp: 1790100000,
  status: { short: 'NS' },
  league: { id: 12, name: 'Euroleague', season: '2026-2027' },
  teams: { home: { id: 30, name: 'Home' }, away: { id: 40, name: 'Away' } },
  scores: { home: { total: null }, away: { total: null } },
};

describe('API-Sports client', () => {
  it('authenticates only in the backend header and validates football and basketball responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(envelope([football])))
      .mockResolvedValueOnce(json(envelope([basketball])));
    const client = new ApiSportsClient({
      apiKey: 'rotated-test-key-not-a-secret',
      fetch: fetchMock,
    });
    await expect(
      client.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).resolves.toMatchObject({ data: [football] });
    await expect(
      client.request('basketball', '/games', {}, z.array(basketballGameSchema)),
    ).resolves.toMatchObject({ data: [basketball] });
    const first = fetchMock.mock.calls[0]!;
    expect(typeof first[0]).toBe('string');
    if (typeof first[0] !== 'string') throw new Error('Expected URL string');
    expect(first[0]).not.toContain('rotated-test-key');
    expect(new Headers(first[1]?.headers).get('x-apisports-key')).toBe(
      'rotated-test-key-not-a-secret',
    );
  });

  it('rejects malformed payloads and HTTP-200 API errors without exposing credentials', async () => {
    const key = 'never-print-this-credential';
    const malformed = new ApiSportsClient({
      apiKey: key,
      fetch: () => Promise.resolve(json({ response: [] })),
      maxRetries: 0,
    });
    await expect(
      malformed.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    const errored = new ApiSportsClient({
      apiKey: key,
      fetch: () =>
        Promise.resolve(json(envelope([], { token: 'Invalid account subscription' }, 0))),
      maxRetries: 0,
    });
    const error = await errored
      .request('football', '/fixtures', {}, z.array(footballFixtureSchema))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiSportsError);
    expect(error).toMatchObject({ code: 'missing_entitlement' });
    expect(String(error)).not.toContain(key);

    const rejectedCredential = new ApiSportsClient({
      apiKey: key,
      fetch: () => Promise.resolve(json(envelope([], { key: 'Invalid API key' }, 0))),
      maxRetries: 0,
    });
    await expect(
      rejectedCredential.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'unauthorized' });

    const minuteLimit = new ApiSportsClient({
      apiKey: key,
      fetch: () => Promise.resolve(json(envelope([], { rate: 'Too many requests per minute' }, 0))),
      maxRetries: 0,
    });
    await expect(
      minuteLimit.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('emits redacted provider rejection detail only through backend telemetry', async () => {
    const key = 'secret-api-key-value';
    const events: ApiSportsRequestEvent[] = [];
    const client = new ApiSportsClient({
      apiKey: key,
      maxRetries: 0,
      onRequest: (event) => events.push(event),
      fetch: () =>
        Promise.resolve(
          json(
            envelope(
              [],
              {
                request: `Invalid date for user@example.com with ${key} and Bearer token-value`,
              },
              0,
            ),
          ),
        ),
    });

    await expect(
      client.request(
        'football',
        '/fixtures',
        { date: '2026-09-22' },
        z.array(footballFixtureSchema),
      ),
    ).rejects.toMatchObject({ code: 'provider_error' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      product: 'football',
      path: '/fixtures',
      outcome: 'failure',
      errorCode: 'provider_error',
    });
    expect(events[0]?.providerDetail).toContain('Invalid date');
    expect(events[0]?.providerDetail).not.toContain(key);
    expect(events[0]?.providerDetail).not.toContain('user@example.com');
    expect(events[0]?.providerDetail).not.toContain('token-value');
  });

  it('reports schema issue paths without including rejected response values', async () => {
    const events: ApiSportsRequestEvent[] = [];
    const client = new ApiSportsClient({
      apiKey: 'test-key',
      maxRetries: 0,
      onRequest: (event) => events.push(event),
      fetch: () =>
        Promise.resolve(
          json(
            envelope([
              {
                fixture: {
                  id: 'sensitive-invalid-id',
                  date: 'invalid-private-date',
                  timestamp: 1,
                  status: { short: 'NS' },
                },
                league: { id: 1, name: 'League', season: 2026 },
                teams: {},
                goals: { home: null, away: null },
              },
            ]),
          ),
        ),
    });

    await expect(
      client.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(events[0]?.providerDetail).toContain('0.fixture.id:invalid_type');
    expect(events[0]?.providerDetail).not.toContain('sensitive-invalid-id');
    expect(events[0]?.providerDetail).not.toContain('invalid-private-date');
  });

  it('accepts documented non-paginated basketball envelopes but still requires football paging', async () => {
    const withoutPaging = (response: unknown) => {
      const { paging, ...value } = envelope(response);
      void paging;
      return value;
    };
    const basketball = new ApiSportsClient({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: () => Promise.resolve(json(withoutPaging([]))),
    });
    await expect(
      basketball.request('basketball', '/games', {}, z.array(basketballGameSchema)),
    ).resolves.toMatchObject({ paging: { current: 1, total: 1 }, data: [] });

    const football = new ApiSportsClient({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: () => Promise.resolve(json(withoutPaging([]))),
    });
    await expect(
      football.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'invalid_response', providerDetail: 'paging:missing' });
  });

  it('handles quota exhaustion, missing entitlement and bounded transient retries', async () => {
    const quota = new ApiSportsClient({
      apiKey: 'test-key',
      fetch: () => Promise.resolve(json({}, 429, { 'x-ratelimit-requests-remaining': '0' })),
      maxRetries: 2,
    });
    await expect(
      quota.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'quota_exhausted' });
    const denied = new ApiSportsClient({
      apiKey: 'test-key',
      fetch: () => Promise.resolve(json({}, 403)),
      maxRetries: 0,
    });
    await expect(
      denied.request('basketball', '/games', {}, z.array(basketballGameSchema)),
    ).rejects.toMatchObject({ code: 'missing_entitlement' });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(envelope([football])));
    const retry = new ApiSportsClient({ apiKey: 'test-key', fetch: fetchMock, maxRetries: 1 });
    await retry.request('football', '/fixtures', {}, z.array(footballFixtureSchema));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds request timeouts', async () => {
    const client = new ApiSportsClient({
      apiKey: 'test-key',
      timeoutMs: 1,
      maxRetries: 0,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    await expect(
      client.request('football', '/fixtures', {}, z.array(footballFixtureSchema)),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('deduplicates concurrent identical provider requests', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const client = new ApiSportsClient({ apiKey: 'test-key', fetch: fetchMock, maxRetries: 0 });
    const first = client.request(
      'football',
      '/fixtures',
      { date: '2026-09-22' },
      z.array(footballFixtureSchema),
    );
    const second = client.request(
      'football',
      '/fixtures',
      { date: '2026-09-22' },
      z.array(footballFixtureSchema),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse?.(json(envelope([football])));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
