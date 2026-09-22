import { describe, expect, it } from 'vitest';
import { evaluateFootballTotal } from '../src/sports/football-statistics.js';
import { candidate } from './fixtures.js';

const now = new Date('2026-09-22T10:00:00Z');
const pick = candidate(1, 1.9, 0, {
  sport: 'football',
  category: 'Goals',
  marketName: 'Over/Under Goals',
  selectionName: 'Over 2.5',
  line: 2.5,
  fixture: {
    id: 'event-1',
    sport: 'football',
    league: 'Premier League',
    homeTeam: 'Home',
    awayTeam: 'Away',
    startsAt: new Date('2026-09-22T18:00:00Z'),
    status: 'scheduled',
  },
});
const games = (venue: 'home' | 'away', goalsFor = 2, goalsAgainst = 1) =>
  Array.from({ length: 5 }, (_, index) => ({
    playedAt: new Date(now.getTime() - (index + 1) * 7 * 86_400_000),
    goalsFor,
    goalsAgainst,
    venue,
  }));
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  providerFixtureId: '100',
  providerCompetitionId: '39',
  season: '2026',
  competition: 'Premier League',
  homeTeam: 'Home',
  awayTeam: 'Away',
  startsAt: new Date('2026-09-22T18:00:00Z'),
  retrievedAt: now,
  home: { games: games('home', 3, 1) },
  away: { games: games('away', 2, 2) },
  lineupStatus: 'unavailable',
  availabilityStatus: 'unavailable',
  contradictions: [],
  source: {
    name: 'API-Sports API-Football',
    url: 'https://api-sports.io/documentation/football/v3',
    authorized: true,
  },
  ...overrides,
});

describe('football total evidence gate', () => {
  it('supports a total only from fresh home/away data', () => {
    expect(evaluateFootballTotal(pick, snapshot(), now)).toMatchObject({
      statisticalSupport: 'supported',
      recommendationVerdict: 'keep',
      statisticalProjection: 4,
    });
  });
  it('rejects stale, incomplete and contradictory data', () => {
    expect(() =>
      evaluateFootballTotal(
        pick,
        snapshot({ retrievedAt: new Date(now.getTime() - 7 * 60 * 60_000) }),
        now,
      ),
    ).toThrow('stale');
    expect(() =>
      evaluateFootballTotal(pick, snapshot({ contradictions: ['official feeds disagree'] }), now),
    ).toThrow('Conflicting');
    expect(() =>
      evaluateFootballTotal(pick, snapshot({ home: { games: games('away') } }), now),
    ).toThrow('home/away');
  });
});
