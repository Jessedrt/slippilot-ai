import { describe, expect, it } from 'vitest';
import { ApiSportsClient } from '../src/api-sports/client.js';
import { ApiSportsFixtureMatcher } from '../src/api-sports/fixture-matcher.js';

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
});
