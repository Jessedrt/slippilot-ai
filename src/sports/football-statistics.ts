import { z } from 'zod';
import type { CandidateSelection, EvidenceSource, SelectionAssessment } from '../types/domain.js';

const gameSchema = z
  .object({
    playedAt: z.coerce.date(),
    goalsFor: z.number().int().nonnegative().max(20),
    goalsAgainst: z.number().int().nonnegative().max(20),
    venue: z.enum(['home', 'away']),
  })
  .strict();

export const footballStatisticsSnapshotSchema = z
  .object({
    providerFixtureId: z.string().min(1),
    providerCompetitionId: z.string().min(1),
    season: z.string().min(1),
    competition: z.string().min(1),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
    startsAt: z.coerce.date(),
    retrievedAt: z.coerce.date(),
    home: z.object({ games: z.array(gameSchema).min(5).max(20) }).strict(),
    away: z.object({ games: z.array(gameSchema).min(5).max(20) }).strict(),
    lineupStatus: z.enum(['confirmed', 'partial', 'unavailable']),
    availabilityStatus: z.enum(['confirmed', 'partial', 'unavailable']),
    contradictions: z.array(z.string().min(1)).max(20),
    source: z
      .object({ name: z.string().min(1), url: z.string().url(), authorized: z.literal(true) })
      .strict(),
  })
  .strict();

export interface FootballStatisticsRequest {
  bookmakerEventId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
}

export interface FootballStatisticsProvider {
  readonly name: string;
  getSnapshot(request: FootballStatisticsRequest): Promise<unknown>;
}

export class FootballEvidenceError extends Error {
  readonly statusCode = 424;
  constructor(
    message = 'Football analysis is unavailable because verified API-Sports statistics are missing or insufficient.',
    readonly reasonCode:
      | 'provider_not_configured'
      | 'provider_unavailable'
      | 'missing_subscription'
      | 'quota_exhausted'
      | 'fixture_unmapped'
      | 'unsupported_competition'
      | 'invalid_or_insufficient_evidence' = 'invalid_or_insufficient_evidence',
  ) {
    super(message);
    this.name = 'FootballEvidenceError';
  }
}

export const isFootballGameTotal = (
  selection: Pick<CandidateSelection, 'marketName' | 'category'>,
): boolean => {
  const label = `${selection.marketName} ${selection.category}`;
  return (
    /(?:over\/under|total goals|goals over|goals under)/i.test(label) &&
    !/(?:team|player|corner|card|half|period|home|away)/i.test(label)
  );
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const lineFrom = (selection: CandidateSelection): number | null => {
  if (selection.line != null && Number.isFinite(selection.line)) return selection.line;
  const match = selection.selectionName.match(/(?:over|under)\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
};

/** Home/away scoring projection from completed same-competition matches; never a win probability. */
export function evaluateFootballTotal(
  selection: CandidateSelection,
  raw: unknown,
  now = new Date(),
): SelectionAssessment {
  if (!isFootballGameTotal(selection))
    throw new FootballEvidenceError(
      'This football market has no implemented metric-specific evaluator.',
    );
  const snapshot = footballStatisticsSnapshotSchema.parse(raw);
  if (
    normalize(snapshot.competition) !== normalize(selection.fixture.league) ||
    normalize(snapshot.homeTeam) !== normalize(selection.fixture.homeTeam) ||
    normalize(snapshot.awayTeam) !== normalize(selection.fixture.awayTeam) ||
    Math.abs(snapshot.startsAt.getTime() - selection.fixture.startsAt.getTime()) > 15 * 60_000
  )
    throw new FootballEvidenceError(
      'API-Sports statistics do not match the SportyBet fixture.',
      'fixture_unmapped',
    );
  const age = now.getTime() - snapshot.retrievedAt.getTime();
  if (age < -60_000 || age > 6 * 60 * 60_000)
    throw new FootballEvidenceError('API-Sports football statistics are stale.');
  if (snapshot.contradictions.length)
    throw new FootballEvidenceError(
      `Conflicting football evidence: ${snapshot.contradictions.join('; ')}.`,
    );
  if (
    snapshot.home.games.some((game) => game.venue !== 'home') ||
    snapshot.away.games.some((game) => game.venue !== 'away')
  )
    throw new FootballEvidenceError('Required home/away samples are incomplete.');
  const allGames = [...snapshot.home.games, ...snapshot.away.games];
  if (allGames.some((game) => now.getTime() - game.playedAt.getTime() > 120 * 86_400_000))
    throw new FootballEvidenceError('Recent-form football samples contain stale matches.');
  const line = lineFrom(selection);
  if (line == null) throw new FootballEvidenceError('The SportyBet goal-total line is missing.');
  const projection = Number(
    (
      (average(snapshot.home.games.map((game) => game.goalsFor)) +
        average(snapshot.away.games.map((game) => game.goalsAgainst)) +
        average(snapshot.away.games.map((game) => game.goalsFor)) +
        average(snapshot.home.games.map((game) => game.goalsAgainst))) /
      2
    ).toFixed(2),
  );
  const direction = /^over\b/i.test(selection.selectionName)
    ? 'over'
    : /^under\b/i.test(selection.selectionName)
      ? 'under'
      : null;
  if (!direction) throw new FootballEvidenceError('The football total direction is ambiguous.');
  const edge = direction === 'over' ? projection - line : line - projection;
  const supported = edge >= 0.35;
  const source: EvidenceSource = {
    name: snapshot.source.name,
    url: snapshot.source.url,
    retrievedAt: snapshot.retrievedAt,
    kind: 'authorized-statistics',
  };
  return {
    evidenceQualityScore: Math.min(
      90,
      72 +
        (snapshot.lineupStatus === 'confirmed' ? 8 : 0) +
        (snapshot.availabilityStatus === 'confirmed' ? 8 : 0),
    ),
    statisticalSupport: supported ? 'supported' : Math.abs(edge) < 0.35 ? 'mixed' : 'insufficient',
    recommendationVerdict: supported ? 'keep' : 'reject',
    assessedAt: now,
    expiresAt: new Date(
      Math.min(selection.fixture.startsAt.getTime(), now.getTime() + 45 * 60_000),
    ),
    sources: [source],
    statisticalProjection: projection,
    bookmakerImpliedProbability: Number((100 / selection.odds).toFixed(2)),
    conflictingEvidence: false,
  };
}
