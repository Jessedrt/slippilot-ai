import { describe, expect, it } from 'vitest';
import { evaluateBasketballTotal } from '../src/sports/basketball-statistics.js';
import { candidate } from './fixtures.js';

const now = new Date('2026-09-22T10:00:00Z');
const pick = (selectionName: string) =>
  candidate(1, 1.9, 0, {
    sport: 'basketball',
    category: 'Total',
    marketName: 'Over/Under (incl. overtime)',
    selectionName,
    line: 165.5,
    fixture: {
      id: 'event-1',
      sport: 'basketball',
      league: 'Test League',
      homeTeam: 'Home',
      awayTeam: 'Away',
      startsAt: new Date('2026-09-22T18:00:00Z'),
      status: 'scheduled',
    },
  });
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1',
  competition: 'Test League',
  retrievedAt: now,
  overtimeIncluded: true,
  lineupStatus: 'confirmed',
  contradictions: [],
  source: {
    name: 'Authorized deterministic fixture',
    url: 'https://stats.example.test/game/1',
    authorized: true,
  },
  home: {
    games: Array.from({ length: 5 }, (_, index) => ({
      playedAt: new Date(now.getTime() - (index + 1) * 86_400_000),
      pointsFor: 75,
      pointsAgainst: 74,
      possessions: 70,
    })),
  },
  away: {
    games: Array.from({ length: 5 }, (_, index) => ({
      playedAt: new Date(now.getTime() - (index + 1) * 86_400_000),
      pointsFor: 76,
      pointsAgainst: 75,
      possessions: 70,
    })),
  },
  ...overrides,
});

describe('basketball total evidence gate', () => {
  it('supports an Under while rejecting the unsupported opposite direction', () => {
    expect(evaluateBasketballTotal(pick('Under 165.5'), snapshot(), now)).toMatchObject({
      statisticalSupport: 'supported',
      recommendationVerdict: 'keep',
      statisticalProjection: 150,
    });
    expect(evaluateBasketballTotal(pick('Over 165.5'), snapshot(), now)).toMatchObject({
      statisticalSupport: 'insufficient',
      recommendationVerdict: 'reject',
    });
  });

  it('rejects missing, stale and contradictory statistics', () => {
    expect(() => evaluateBasketballTotal(pick('Under 165.5'), {}, now)).toThrow();
    expect(() =>
      evaluateBasketballTotal(
        pick('Under 165.5'),
        snapshot({ retrievedAt: new Date(now.getTime() - 7 * 60 * 60_000) }),
        now,
      ),
    ).toThrow('stale');
    expect(() =>
      evaluateBasketballTotal(
        pick('Under 165.5'),
        snapshot({ contradictions: ['official feeds disagree'] }),
        now,
      ),
    ).toThrow('conflicting');
  });
});
