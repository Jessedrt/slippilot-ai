import { z } from 'zod';
import type { ApiSportsClient, ApiSportsProduct } from './client.js';
import { VerifiedFixtureIdentityRegistry } from './fixture-identity.js';
import type { ApiSportsOperations } from './operations.js';

const teamSchema = z
  .object({ id: z.number().int().positive(), name: z.string().min(1) })
  .passthrough();
export const footballFixtureSchema = z
  .object({
    fixture: z
      .object({
        id: z.number().int().positive(),
        date: z.string().datetime({ offset: true }),
        timestamp: z.number().int().positive(),
        status: z.object({ short: z.string().min(1) }).passthrough(),
      })
      .passthrough(),
    league: z
      .object({
        id: z.number().int().positive(),
        name: z.string().min(1),
        season: z.number().int(),
      })
      .passthrough(),
    teams: z.object({ home: teamSchema, away: teamSchema }).strict(),
    goals: z
      .object({
        home: z.number().int().nonnegative().nullable(),
        away: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .passthrough();

const basketballScoreSchema = z
  .object({
    quarter_1: z.number().int().nonnegative().nullable().optional(),
    quarter_2: z.number().int().nonnegative().nullable().optional(),
    quarter_3: z.number().int().nonnegative().nullable().optional(),
    quarter_4: z.number().int().nonnegative().nullable().optional(),
    over_time: z.number().int().nonnegative().nullable().optional(),
    total: z.number().int().nonnegative().nullable(),
  })
  .passthrough();

export const basketballGameSchema = z
  .object({
    id: z.number().int().positive(),
    date: z.string().min(1),
    timestamp: z.number().int().positive(),
    status: z.object({ short: z.string().min(1) }).passthrough(),
    league: z
      .object({
        id: z.number().int().positive(),
        name: z.string().min(1),
        season: z.string().min(1),
      })
      .passthrough(),
    teams: z.object({ home: teamSchema, away: teamSchema }).strict(),
    scores: z.object({ home: basketballScoreSchema, away: basketballScoreSchema }).strict(),
  })
  .passthrough();

export type FootballFixture = z.infer<typeof footballFixtureSchema>;
export type BasketballGame = z.infer<typeof basketballGameSchema>;

export interface FixtureMatchRequest {
  competition: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
}

export class FixtureMappingError extends Error {
  readonly statusCode = 424;
  constructor(
    readonly reason:
      | 'unmapped'
      | 'ambiguous'
      | 'orientation_mismatch'
      | 'unsupported_competition'
      | 'kickoff_mismatch'
      | 'status_invalid',
    message: string,
  ) {
    super(message);
    this.name = 'FixtureMappingError';
  }
}

export const normalizedProviderName = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\butd\b/g, 'united')
    .trim();

const day = (date: Date) => date.toISOString().slice(0, 10);
const closeKickoff = (timestamp: number, startsAt: Date) =>
  Math.abs(timestamp * 1000 - startsAt.getTime()) <= 15 * 60_000;

const lookupDays = (startsAt: Date): string[] => [
  ...new Set([-15, 0, 15].map((minutes) => day(new Date(startsAt.getTime() + minutes * 60_000)))),
];

export class ApiSportsFixtureMatcher {
  constructor(
    private readonly client: ApiSportsClient,
    private readonly identities = new VerifiedFixtureIdentityRegistry(),
    private readonly operations?: ApiSportsOperations,
  ) {}

  async matchFootball(request: FixtureMatchRequest): Promise<FootballFixture> {
    const results = await Promise.all(
      lookupDays(request.startsAt).map((date) =>
        this.client.requestAllPages(
          'football',
          '/fixtures',
          { date, timezone: 'UTC' },
          footballFixtureSchema,
          120,
        ),
      ),
    );
    try {
      const fixture = this.unique<FootballFixture>(
        'football',
        this.uniqueItems(
          results.flatMap((result) => result.data),
          (item) => item.fixture.id,
        ),
        request,
      );
      this.operations?.recordFixture('football', true, this.sources(results));
      return fixture;
    } catch (error) {
      this.operations?.recordFixture(
        'football',
        false,
        this.sources(results),
        error instanceof FixtureMappingError ? error.reason : 'provider_failure',
      );
      throw error;
    }
  }

  async matchBasketball(request: FixtureMatchRequest): Promise<BasketballGame> {
    const results = await Promise.all(
      lookupDays(request.startsAt).map((date) =>
        this.client.requestAllPages(
          'basketball',
          '/games',
          { date, timezone: 'UTC' },
          basketballGameSchema,
          120,
        ),
      ),
    );
    try {
      const game = this.unique<BasketballGame>(
        'basketball',
        this.uniqueItems(
          results.flatMap((result) => result.data),
          (item) => item.id,
        ),
        request,
      );
      this.operations?.recordFixture('basketball', true, this.sources(results));
      return game;
    } catch (error) {
      this.operations?.recordFixture(
        'basketball',
        false,
        this.sources(results),
        error instanceof FixtureMappingError ? error.reason : 'provider_failure',
      );
      throw error;
    }
  }

  private unique<T extends FootballFixture | BasketballGame>(
    product: ApiSportsProduct,
    items: T[],
    request: FixtureMatchRequest,
  ): T {
    const competition = normalizedProviderName(request.competition);
    const home = normalizedProviderName(request.homeTeam);
    const away = normalizedProviderName(request.awayTeam);
    const competitionId = this.identities.competitionId(product, request.competition);
    const homeId = this.identities.teamId(product, request.homeTeam);
    const awayId = this.identities.teamId(product, request.awayTeam);
    const sameTeam = (team: { id: number; name: string }, name: string, id?: number) =>
      id !== undefined ? team.id === id : normalizedProviderName(team.name) === name;
    const inCompetition = items.filter((item) =>
      competitionId !== undefined
        ? item.league.id === competitionId
        : normalizedProviderName(item.league.name) === competition,
    );
    const orientedIdentity = (item: T) =>
      sameTeam(item.teams.home, home, homeId) && sameTeam(item.teams.away, away, awayId);
    const reversedIdentity = (item: T) =>
      sameTeam(item.teams.home, away, awayId) && sameTeam(item.teams.away, home, homeId);
    const timed = items.filter((item) =>
      closeKickoff(
        product === 'football'
          ? (item as FootballFixture).fixture.timestamp
          : (item as BasketballGame).timestamp,
        request.startsAt,
      ),
    );
    const sameCompetition = timed.filter((item) => inCompetition.includes(item));
    const oriented = sameCompetition.filter(orientedIdentity);
    if (oriented.length > 1)
      throw new FixtureMappingError(
        'ambiguous',
        'Multiple API-Sports fixtures match this SportyBet event.',
      );
    if (oriented.length === 1) {
      const item = oriented[0]!;
      const status =
        product === 'football'
          ? (item as FootballFixture).fixture.status.short
          : (item as BasketballGame).status.short;
      if (!['NS', 'TBD'].includes(status))
        throw new FixtureMappingError(
          'status_invalid',
          'The API-Sports fixture is not in an accepted scheduled status.',
        );
      return item;
    }
    if (inCompetition.some(orientedIdentity))
      throw new FixtureMappingError(
        'kickoff_mismatch',
        'API-Sports lists the same teams outside the accepted kickoff-time window.',
      );
    const reversed = sameCompetition.some(reversedIdentity);
    if (reversed)
      throw new FixtureMappingError(
        'orientation_mismatch',
        'API-Sports lists the teams with the opposite home/away orientation.',
      );
    if (!sameCompetition.length && timed.length)
      throw new FixtureMappingError(
        'unsupported_competition',
        'The SportyBet competition could not be mapped exactly to API-Sports.',
      );
    throw new FixtureMappingError(
      'unmapped',
      'No exact API-Sports fixture matched the SportyBet event.',
    );
  }

  private uniqueItems<T>(items: T[], id: (item: T) => number): T[] {
    return [...new Map(items.map((item) => [id(item), item])).values()];
  }

  private sources(
    results: Array<{ source: 'cache' | 'live' | 'mixed' }>,
  ): 'cache' | 'live' | 'mixed' {
    const sources = new Set(results.map((result) => result.source));
    return sources.size > 1 ? 'mixed' : (results[0]?.source ?? 'live');
  }
}
