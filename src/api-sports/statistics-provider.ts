import { z } from 'zod';
import type {
  BasketballStatisticsProvider,
  BasketballStatisticsRequest,
} from '../sports/basketball-statistics.js';
import type {
  FootballStatisticsProvider,
  FootballStatisticsRequest,
} from '../sports/football-statistics.js';
import { ApiSportsError, type ApiSportsClient } from './client.js';
import type { VerifiedFixtureIdentityRegistry } from './fixture-identity.js';
import type { ApiSportsOperations } from './operations.js';
import {
  ApiSportsFixtureMatcher,
  basketballGameSchema,
  footballFixtureSchema,
  type BasketballGame,
  type FootballFixture,
} from './fixture-matcher.js';

const footballList = z.array(footballFixtureSchema);
const completedFootball = new Set(['FT', 'AET', 'PEN']);
const completedBasketball = new Set(['FT', 'AOT']);

const regulationTotal = (score: BasketballGame['scores']['home']): number | null => {
  const quarters = [score.quarter_1, score.quarter_2, score.quarter_3, score.quarter_4];
  return quarters.every((value) => value != null)
    ? quarters.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
};

export class ApiSportsFootballStatisticsProvider implements FootballStatisticsProvider {
  readonly name = 'API-Sports API-Football';
  private readonly matcher: ApiSportsFixtureMatcher;
  constructor(
    private readonly client: ApiSportsClient,
    identities?: VerifiedFixtureIdentityRegistry,
    private readonly operations?: ApiSportsOperations,
  ) {
    this.matcher = new ApiSportsFixtureMatcher(client, identities, operations);
  }

  async getSnapshot(request: FootballStatisticsRequest): Promise<unknown> {
    const fixture = await this.matcher.matchFootball(request);
    try {
      const [home, away] = await Promise.all([
        this.client.request(
          'football',
          '/fixtures',
          {
            team: fixture.teams.home.id,
            league: fixture.league.id,
            season: fixture.league.season,
            last: 20,
            status: 'FT-AET-PEN',
          },
          footballList,
          900,
        ),
        this.client.request(
          'football',
          '/fixtures',
          {
            team: fixture.teams.away.id,
            league: fixture.league.id,
            season: fixture.league.season,
            last: 20,
            status: 'FT-AET-PEN',
          },
          footballList,
          900,
        ),
      ]);
      const homeGames = this.footballGames(home.data, fixture.teams.home.id, 'home');
      const awayGames = this.footballGames(away.data, fixture.teams.away.id, 'away');
      const snapshot = {
        providerFixtureId: String(fixture.fixture.id),
        providerCompetitionId: String(fixture.league.id),
        season: String(fixture.league.season),
        // The matcher has already verified these identities. Keep the bookmaker
        // labels so safe aliases do not fail a second exact-name comparison.
        competition: request.competition,
        homeTeam: request.homeTeam,
        awayTeam: request.awayTeam,
        startsAt: request.startsAt,
        retrievedAt: new Date(Math.max(home.retrievedAt.getTime(), away.retrievedAt.getTime())),
        home: { games: homeGames },
        away: { games: awayGames },
        lineupStatus: 'unavailable',
        availabilityStatus: 'unavailable',
        contradictions: [],
        source: {
          name: 'API-Sports API-Football',
          url: 'https://api-sports.io/documentation/football/v3',
          authorized: true,
        },
      };
      this.operations?.recordStatistics(
        'football',
        true,
        home.source === away.source ? home.source : 'mixed',
      );
      return snapshot;
    } catch (error) {
      this.operations?.recordStatistics(
        'football',
        false,
        undefined,
        error instanceof ApiSportsError ? error.code : 'invalid_response',
      );
      throw error;
    }
  }

  private footballGames(fixtures: FootballFixture[], teamId: number, venue: 'home' | 'away') {
    return fixtures
      .filter(
        (item) =>
          completedFootball.has(item.fixture.status.short) &&
          item.teams[venue].id === teamId &&
          item.goals.home != null &&
          item.goals.away != null,
      )
      .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
      .slice(0, 10)
      .map((item) => ({
        playedAt: new Date(item.fixture.timestamp * 1000),
        goalsFor: venue === 'home' ? item.goals.home! : item.goals.away!,
        goalsAgainst: venue === 'home' ? item.goals.away! : item.goals.home!,
        venue,
      }));
  }
}

export class ApiSportsBasketballStatisticsProvider implements BasketballStatisticsProvider {
  readonly name = 'API-Sports API-Basketball';
  private readonly matcher: ApiSportsFixtureMatcher;
  constructor(
    private readonly client: ApiSportsClient,
    identities?: VerifiedFixtureIdentityRegistry,
    private readonly operations?: ApiSportsOperations,
  ) {
    this.matcher = new ApiSportsFixtureMatcher(client, identities, operations);
  }

  async getSnapshot(request: BasketballStatisticsRequest): Promise<unknown> {
    const game = await this.matcher.matchBasketball(request);
    try {
      const [home, away] = await Promise.all([
        this.client.requestAllPages(
          'basketball',
          '/games',
          { team: game.teams.home.id, league: game.league.id, season: game.league.season },
          basketballGameSchema,
          900,
        ),
        this.client.requestAllPages(
          'basketball',
          '/games',
          { team: game.teams.away.id, league: game.league.id, season: game.league.season },
          basketballGameSchema,
          900,
        ),
      ]);
      const homeGames = this.basketballGames(
        home.data,
        game.teams.home.id,
        'home',
        request.marketOvertimeIncluded,
      );
      const awayGames = this.basketballGames(
        away.data,
        game.teams.away.id,
        'away',
        request.marketOvertimeIncluded,
      );
      const snapshot = {
        providerEventId: String(game.id),
        providerCompetitionId: String(game.league.id),
        competition: request.competition,
        homeTeam: request.homeTeam,
        awayTeam: request.awayTeam,
        startsAt: request.startsAt,
        retrievedAt: new Date(Math.max(home.retrievedAt.getTime(), away.retrievedAt.getTime())),
        overtimeIncluded: request.marketOvertimeIncluded,
        lineupStatus: 'unavailable',
        home: { games: homeGames },
        away: { games: awayGames },
        contradictions: [],
        source: {
          name: 'API-Sports API-Basketball',
          url: 'https://api-sports.io/documentation/basketball/v1',
          authorized: true,
        },
      };
      this.operations?.recordStatistics(
        'basketball',
        true,
        home.source === away.source ? home.source : 'mixed',
      );
      return snapshot;
    } catch (error) {
      this.operations?.recordStatistics(
        'basketball',
        false,
        undefined,
        error instanceof ApiSportsError ? error.code : 'invalid_response',
      );
      throw error;
    }
  }

  private basketballGames(
    games: BasketballGame[],
    teamId: number,
    venue: 'home' | 'away',
    overtime: boolean,
  ) {
    return games
      .filter(
        (item) => completedBasketball.has(item.status.short) && item.teams[venue].id === teamId,
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .flatMap((item) => {
        const own = overtime ? item.scores[venue].total : regulationTotal(item.scores[venue]);
        const opponentVenue = venue === 'home' ? 'away' : 'home';
        const against = overtime
          ? item.scores[opponentVenue].total
          : regulationTotal(item.scores[opponentVenue]);
        return own == null || against == null
          ? []
          : [{ playedAt: new Date(item.timestamp * 1000), pointsFor: own, pointsAgainst: against }];
      })
      .slice(0, 10);
  }
}
