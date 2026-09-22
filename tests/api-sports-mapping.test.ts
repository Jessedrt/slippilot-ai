import { describe, expect, it } from 'vitest';
import { ApiSportsClient } from '../src/api-sports/client.js';
import { ApiSportsFixtureMatcher } from '../src/api-sports/fixture-matcher.js';
import { VerifiedFixtureIdentityRegistry } from '../src/api-sports/fixture-identity.js';

const start = new Date('2026-09-22T18:00:00Z');
const item = (home = 'Paris BC', away = 'London BC', league = 'Euroleague', id = 1) => ({
  id,
  date: start.toISOString(),
  timestamp: Math.floor(start.getTime() / 1000),
  status: { short: 'NS' },
  league: { id: 12, name: league, season: '2026-2027' },
  teams: { home: { id: 30, name: home }, away: { id: 40, name: away } },
  scores: { home: { total: null }, away: { total: null } },
});
const matcher = (games: unknown[]) =>
  new ApiSportsFixtureMatcher(
    new ApiSportsClient({
      apiKey: 'mock-only-key',
      maxRetries: 0,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              get: 'games',
              parameters: {},
              errors: {},
              results: games.length,
              paging: { current: 1, total: 1 },
              response: games,
            }),
            { status: 200 },
          ),
        ),
    }),
  );
const request = {
  competition: 'Euroleague',
  homeTeam: 'Paris BC',
  awayTeam: 'London BC',
  startsAt: start,
};

describe('API-Sports exact fixture matching', () => {
  it('accepts only an exact competition, orientation and kickoff match', async () => {
    await expect(matcher([item()]).matchBasketball(request)).resolves.toMatchObject({ id: 1 });
  });
  it('rejects ambiguous names, home/away reversal and unsupported competitions', async () => {
    await expect(
      matcher([item(), item('Paris BC', 'London BC', 'Euroleague', 2)]).matchBasketball(request),
    ).rejects.toMatchObject({ reason: 'ambiguous' });
    await expect(
      matcher([item('London BC', 'Paris BC')]).matchBasketball(request),
    ).rejects.toMatchObject({ reason: 'orientation_mismatch' });
    await expect(
      matcher([item('Paris BC', 'London BC', 'Different League')]).matchBasketball(request),
    ).rejects.toMatchObject({ reason: 'unsupported_competition' });
    await expect(
      matcher([item('Paris United', 'London BC')]).matchBasketball(request),
    ).rejects.toMatchObject({ reason: 'unmapped' });
  });

  it('distinguishes kickoff and fixture-status contradictions from name mismatches', async () => {
    const late = {
      ...item(),
      timestamp: Math.floor((start.getTime() + 16 * 60_000) / 1000),
    };
    await expect(matcher([late]).matchBasketball(request)).rejects.toMatchObject({
      reason: 'kickoff_mismatch',
    });
    const started = { ...item(), status: { short: 'Q1' } };
    await expect(matcher([started]).matchBasketball(request)).rejects.toMatchObject({
      reason: 'status_invalid',
    });
  });

  it('accepts safe abbreviations and explicit provider-ID mappings without fuzzy guessing', async () => {
    const client = new ApiSportsClient({
      apiKey: 'mock-only-key',
      maxRetries: 0,
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              get: 'games',
              parameters: {},
              errors: {},
              results: 1,
              paging: { current: 1, total: 1 },
              response: [item('Paris United', 'London BC', 'Euroleague')],
            }),
          ),
        ),
    });
    const registry = new VerifiedFixtureIdentityRegistry({
      competitions: [{ product: 'basketball', sportyBetName: 'Euro League', apiSportsId: 12 }],
      teams: [{ product: 'basketball', sportyBetName: 'Paris Utd', apiSportsId: 30 }],
    });
    await expect(
      new ApiSportsFixtureMatcher(client, registry).matchBasketball({
        ...request,
        competition: 'Euro League',
        homeTeam: 'Paris Utd',
      }),
    ).resolves.toMatchObject({ id: 1 });
    const contradictoryRegistry = new VerifiedFixtureIdentityRegistry({
      competitions: [{ product: 'basketball', sportyBetName: 'Euroleague', apiSportsId: 999 }],
      teams: [],
    });
    await expect(
      new ApiSportsFixtureMatcher(client, contradictoryRegistry).matchBasketball(request),
    ).rejects.toMatchObject({ reason: 'unsupported_competition' });
  });

  it('checks an adjacent UTC date only when the kickoff window crosses midnight', async () => {
    const boundary = new Date('2026-09-23T00:05:00Z');
    const previous = {
      ...item(),
      date: '2026-09-22T23:55:00Z',
      timestamp: Math.floor(new Date('2026-09-22T23:55:00Z').getTime() / 1000),
    };
    const calls: string[] = [];
    const client = new ApiSportsClient({
      apiKey: 'mock-only-key',
      maxRetries: 0,
      fetch: (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        calls.push(url);
        const response = url.includes('date=2026-09-22') ? [previous] : [];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              get: 'games',
              parameters: {},
              errors: {},
              results: response.length,
              paging: { current: 1, total: 1 },
              response,
            }),
          ),
        );
      },
    });
    await expect(
      new ApiSportsFixtureMatcher(client).matchBasketball({ ...request, startsAt: boundary }),
    ).resolves.toMatchObject({ id: 1 });
    expect(calls.some((url) => url.includes('date=2026-09-22'))).toBe(true);
    expect(calls.some((url) => url.includes('date=2026-09-23'))).toBe(true);
  });
});
