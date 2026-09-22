import type { SportyBetEvent } from '../sportybet/contracts.js';
import type { Sport } from '../types/domain.js';
import { FixtureMappingError } from './fixture-matcher.js';
import type { ApiSportsFixtureMatcher } from './fixture-matcher.js';

export interface CoverageReport {
  sport: 'football' | 'basketball';
  generatedAt: string;
  total: number;
  mapped: number;
  unmapped: number;
  ambiguous: number;
  orientationMismatches: number;
  unsupportedCompetitions: number;
  competitions: Array<{ name: string; total: number; mapped: number }>;
}

/** Credentialed callers supply real SportyBet fixtures; no mock result is labelled live. */
export async function buildApiSportsCoverageReport(
  sport: Extract<Sport, 'football' | 'basketball'>,
  events: SportyBetEvent[],
  matcher: ApiSportsFixtureMatcher,
  now = new Date(),
): Promise<CoverageReport> {
  const report: CoverageReport = {
    sport,
    generatedAt: now.toISOString(),
    total: events.length,
    mapped: 0,
    unmapped: 0,
    ambiguous: 0,
    orientationMismatches: 0,
    unsupportedCompetitions: 0,
    competitions: [],
  };
  const competitions = new Map<string, { total: number; mapped: number }>();
  for (const event of events) {
    const competition = event.league?.trim() || 'Unknown';
    const summary = competitions.get(competition) ?? { total: 0, mapped: 0 };
    summary.total += 1;
    competitions.set(competition, summary);
    try {
      const request = {
        competition,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        startsAt: event.startsAt,
      };
      if (sport === 'football') await matcher.matchFootball(request);
      else await matcher.matchBasketball(request);
      report.mapped += 1;
      summary.mapped += 1;
    } catch (error) {
      if (!(error instanceof FixtureMappingError)) {
        report.unmapped += 1;
        continue;
      }
      if (error.reason === 'ambiguous') report.ambiguous += 1;
      else if (error.reason === 'orientation_mismatch') report.orientationMismatches += 1;
      else if (error.reason === 'unsupported_competition') report.unsupportedCompetitions += 1;
      else report.unmapped += 1;
    }
  }
  report.competitions = [...competitions.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return report;
}
