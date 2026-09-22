import { describe, expect, it } from 'vitest';
import { buildApiSportsCoverageReport } from '../src/api-sports/coverage.js';
import { ApiSportsError } from '../src/api-sports/client.js';
import { FixtureMappingError } from '../src/api-sports/fixture-matcher.js';

const event = (id: string) => ({
  providerEventId: id,
  league: 'Test League',
  homeTeam: id,
  awayTeam: 'Away',
  startsAt: new Date('2026-09-22T18:00:00Z'),
  status: 'scheduled' as const,
});

describe('API-Sports coverage reporting', () => {
  it('reports verified IDs, not inferred mappings or mock data presented as live', async () => {
    const events = ['mapped', 'ambiguous', 'unsupported'].map(event);
    const matcher = {
      matchFootball: ({ homeTeam }: { homeTeam: string }) => {
        if (homeTeam === 'mapped')
          return Promise.resolve({
            fixture: { id: 41 },
            league: { id: 3, season: 2026 },
            teams: { home: { id: 11 }, away: { id: 12 } },
          });
        if (homeTeam === 'ambiguous')
          return Promise.reject(new FixtureMappingError('ambiguous', 'ambiguous'));
        return Promise.reject(new FixtureMappingError('unsupported_competition', 'unsupported'));
      },
    };
    const report = await buildApiSportsCoverageReport(
      'football',
      events,
      matcher as never,
      new Date('2026-09-22T10:00:00Z'),
    );
    expect(report).toMatchObject({
      generatedAt: '2026-09-22T10:00:00.000Z',
      total: 3,
      mapped: 1,
      ambiguous: 1,
      unsupportedCompetitions: 1,
      mappedFixtures: [
        {
          sportyBetEventId: 'mapped',
          apiSportsFixtureId: '41',
          apiSportsCompetitionId: '3',
          apiSportsHomeTeamId: '11',
          apiSportsAwayTeamId: '12',
          apiSportsSeason: '2026',
        },
      ],
    });
  });

  it('exports exact basketball provider IDs and season', async () => {
    const matcher = {
      matchBasketball: () =>
        Promise.resolve({
          id: 57,
          league: { id: 9, season: '2026-2027' },
          teams: { home: { id: 21 }, away: { id: 22 } },
        }),
    };
    const report = await buildApiSportsCoverageReport(
      'basketball',
      [event('sporty-basketball-id')],
      matcher as never,
    );
    expect(report.mappedFixtures).toEqual([
      {
        sportyBetEventId: 'sporty-basketball-id',
        apiSportsFixtureId: '57',
        apiSportsCompetitionId: '9',
        apiSportsHomeTeamId: '21',
        apiSportsAwayTeamId: '22',
        apiSportsSeason: '2026-2027',
      },
    ]);
  });

  it('aborts rather than misreporting credential and quota failures as unmapped', async () => {
    const matcher = {
      matchFootball: () =>
        Promise.reject(new ApiSportsError('quota_exhausted', 'Daily quota exhausted.')),
    };
    await expect(
      buildApiSportsCoverageReport('football', [event('fixture')], matcher as never),
    ).rejects.toMatchObject({ code: 'quota_exhausted' });
  });
});
