import { z } from 'zod';
import type { CandidateSelection, EvidenceSource, SelectionAssessment } from '../types/domain.js';

const gameSchema = z
  .object({
    playedAt: z.coerce.date(),
    pointsFor: z.number().finite().nonnegative().max(250),
    pointsAgainst: z.number().finite().nonnegative().max(250),
    possessions: z.number().finite().positive().max(200).optional(),
  })
  .strict();

const teamSchema = z
  .object({
    games: z.array(gameSchema).min(5).max(30),
  })
  .strict();

export const basketballStatisticsSnapshotSchema = z
  .object({
    providerEventId: z.string().min(1),
    providerCompetitionId: z.string().min(1),
    competition: z.string().min(1),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
    startsAt: z.coerce.date(),
    retrievedAt: z.coerce.date(),
    overtimeIncluded: z.boolean(),
    lineupStatus: z.enum(['confirmed', 'partial', 'unavailable']),
    home: teamSchema,
    away: teamSchema,
    contradictions: z.array(z.string().min(1)).max(20),
    source: z
      .object({
        name: z.string().min(1),
        url: z.string().url(),
        authorized: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type BasketballStatisticsSnapshot = z.infer<typeof basketballStatisticsSnapshotSchema>;

export interface BasketballStatisticsRequest {
  bookmakerEventId: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
}

export interface BasketballStatisticsProvider {
  readonly name: string;
  /** Resolve the exact bookmaker fixture to a licensed provider event; never guess a match. */
  getSnapshot(request: BasketballStatisticsRequest): Promise<unknown>;
}

export class BasketballEvidenceError extends Error {
  readonly statusCode = 424;
  constructor(
    message = 'Insufficient statistical evidence: a documented basketball statistics provider is not configured or did not return a valid, fresh snapshot.',
    readonly reasonCode:
      | 'provider_not_configured'
      | 'provider_unavailable'
      | 'invalid_or_insufficient_evidence' = 'invalid_or_insufficient_evidence',
  ) {
    super(message);
    this.name = 'BasketballEvidenceError';
  }
}

export class DisabledBasketballStatisticsProvider implements BasketballStatisticsProvider {
  readonly name = 'disabled';
  getSnapshot(): Promise<never> {
    return Promise.reject(
      new BasketballEvidenceError(
        'Basketball totals are unavailable because no authorized statistics provider is configured. Odds are not used as evidence and no statistics are invented.',
        'provider_not_configured',
      ),
    );
  }
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const lineFrom = (selection: CandidateSelection): number | null => {
  if (selection.line != null && Number.isFinite(selection.line)) return selection.line;
  const match = selection.selectionName.match(/(?:over|under|[ou])\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
};

export function isBasketballGameTotal(
  selection: Pick<CandidateSelection, 'marketName' | 'category'>,
): boolean {
  const label = `${selection.marketName} ${selection.category}`;
  return (
    /(?:over\/under|\btotal\b|\bo\/u\b)/i.test(label) &&
    !/(?:team|player|quarter|half|period|home|away|competitor)/i.test(label)
  );
}

/** Deterministic projection from validated provider data; it is not a win probability. */
export function evaluateBasketballTotal(
  selection: CandidateSelection,
  rawSnapshot: unknown,
  now = new Date(),
): SelectionAssessment {
  if (!isBasketballGameTotal(selection)) {
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: this basketball market type has no implemented metric-specific evaluator.',
    );
  }
  const snapshot = basketballStatisticsSnapshotSchema.parse(rawSnapshot);
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (
    normalize(snapshot.competition) !== normalize(selection.fixture.league) ||
    normalize(snapshot.homeTeam) !== normalize(selection.fixture.homeTeam) ||
    normalize(snapshot.awayTeam) !== normalize(selection.fixture.awayTeam) ||
    Math.abs(snapshot.startsAt.getTime() - selection.fixture.startsAt.getTime()) > 15 * 60_000
  )
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: statistics do not match the bookmaker event.',
    );
  const marketIncludesOvertime = /(?:incl(?:uding)?\.?\s*overtime|with overtime)/i.test(
    selection.marketName,
  );
  if (marketIncludesOvertime !== snapshot.overtimeIncluded)
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: statistics and bookmaker market use different overtime rules.',
    );
  const age = now.getTime() - snapshot.retrievedAt.getTime();
  if (age < -60_000 || age > 6 * 60 * 60_000)
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: the basketball statistics snapshot is stale.',
    );
  if (snapshot.contradictions.length)
    throw new BasketballEvidenceError(
      `Insufficient statistical evidence: conflicting sources (${snapshot.contradictions.join('; ')}).`,
    );
  const allGames = [...snapshot.home.games, ...snapshot.away.games];
  if (allGames.some((game) => now.getTime() - game.playedAt.getTime() > 60 * 86_400_000))
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: recent-form samples contain stale games.',
    );
  const line = lineFrom(selection);
  if (line == null)
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: the bookmaker total line is missing.',
    );
  const homeFor = average(snapshot.home.games.map((game) => game.pointsFor));
  const homeAgainst = average(snapshot.home.games.map((game) => game.pointsAgainst));
  const awayFor = average(snapshot.away.games.map((game) => game.pointsFor));
  const awayAgainst = average(snapshot.away.games.map((game) => game.pointsAgainst));
  let projection = (homeFor + awayAgainst + awayFor + homeAgainst) / 2;
  const withPossessions = allGames.filter((game) => game.possessions != null);
  if (withPossessions.length === allGames.length) {
    const pace = average(withPossessions.map((game) => game.possessions!));
    const efficiencyTotal = average(
      withPossessions.map(
        (game) => ((game.pointsFor + game.pointsAgainst) / game.possessions!) * pace,
      ),
    );
    projection = (projection + efficiencyTotal) / 2;
  }
  projection = Number(projection.toFixed(1));
  const direction = /^under\b/i.test(selection.selectionName)
    ? 'under'
    : /^over\b/i.test(selection.selectionName)
      ? 'over'
      : null;
  if (!direction)
    throw new BasketballEvidenceError(
      'Insufficient statistical evidence: total direction is ambiguous.',
    );
  const edge = direction === 'over' ? projection - line : line - projection;
  const supported = edge >= 3;
  const source: EvidenceSource = {
    name: snapshot.source.name,
    url: snapshot.source.url,
    retrievedAt: snapshot.retrievedAt,
    kind: 'authorized-statistics',
  };
  const expiresAt = new Date(
    Math.min(selection.fixture.startsAt.getTime(), now.getTime() + 45 * 60_000),
  );
  return {
    evidenceQualityScore: Math.min(
      95,
      70 +
        (withPossessions.length === allGames.length ? 10 : 0) +
        (snapshot.lineupStatus === 'confirmed' ? 10 : snapshot.lineupStatus === 'partial' ? 4 : 0),
    ),
    statisticalSupport: supported ? 'supported' : Math.abs(edge) < 3 ? 'mixed' : 'insufficient',
    recommendationVerdict: supported ? 'keep' : 'reject',
    assessedAt: now,
    expiresAt,
    sources: [source],
    statisticalProjection: projection,
    bookmakerImpliedProbability: Number((100 / selection.odds).toFixed(2)),
    conflictingEvidence: false,
  };
}
