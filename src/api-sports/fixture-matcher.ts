import { z } from 'zod';
import type { ApiSportsClient, ApiSportsProduct } from './client.js';

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
    readonly reason: 'unmapped' | 'ambiguous' | 'orientation_mismatch' | 'unsupported_competition',
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
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const day = (date: Date) => date.toISOString().slice(0, 10);
const closeKickoff = (timestamp: number, startsAt: Date) =>
  Math.abs(timestamp * 1000 - startsAt.getTime()) <= 15 * 60_000;

export class ApiSportsFixtureMatcher {
  constructor(private readonly client: ApiSportsClient) {}

  async matchFootball(request: FixtureMatchRequest): Promise<FootballFixture> {
    const result = await this.client.request(
      'football',
      '/fixtures',
      { date: day(request.startsAt), timezone: 'UTC' },
      z.array(footballFixtureSchema),
      120,
    );
    return this.unique<FootballFixture>('football', result.data, request);
  }

  async matchBasketball(request: FixtureMatchRequest): Promise<BasketballGame> {
    const result = await this.client.request(
      'basketball',
      '/games',
      { date: day(request.startsAt), timezone: 'UTC' },
      z.array(basketballGameSchema),
      120,
    );
    return this.unique<BasketballGame>('basketball', result.data, request);
  }

  private unique<T extends FootballFixture | BasketballGame>(
    product: ApiSportsProduct,
    items: T[],
    request: FixtureMatchRequest,
  ): T {
    const competition = normalizedProviderName(request.competition);
    const home = normalizedProviderName(request.homeTeam);
    const away = normalizedProviderName(request.awayTeam);
    const timed = items.filter((item) =>
      closeKickoff(
        product === 'football'
          ? (item as FootballFixture).fixture.timestamp
          : (item as BasketballGame).timestamp,
        request.startsAt,
      ),
    );
    const sameCompetition = timed.filter(
      (item) => normalizedProviderName(item.league.name) === competition,
    );
    const oriented = sameCompetition.filter(
      (item) =>
        normalizedProviderName(item.teams.home.name) === home &&
        normalizedProviderName(item.teams.away.name) === away,
    );
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
        throw new FixtureMappingError('unmapped', 'The API-Sports fixture is not scheduled.');
      return item;
    }
    const reversed = sameCompetition.some(
      (item) =>
        normalizedProviderName(item.teams.home.name) === away &&
        normalizedProviderName(item.teams.away.name) === home,
    );
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
}
