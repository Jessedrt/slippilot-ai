import { describe, expect, it } from 'vitest';
import { buildApiSportsCoverageReport } from '../src/api-sports/coverage.js';
import { FixtureMappingError } from '../src/api-sports/fixture-matcher.js';

describe('API-Sports coverage reporting', () => {
  it('separates deterministic mock coverage from live provider coverage', async () => {
    const events = ['mapped', 'ambiguous', 'unsupported'].map((id) => ({
      providerEventId: id,
      league: 'Test League',
      homeTeam: id,
      awayTeam: 'Away',
      startsAt: new Date('2026-09-22T18:00:00Z'),
      status: 'scheduled' as const,
    }));
    const matcher = {
      matchFootball: ({ homeTeam }: { homeTeam: string }) => {
        if (homeTeam === 'mapped') return Promise.resolve({});
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
    });
  });
});
