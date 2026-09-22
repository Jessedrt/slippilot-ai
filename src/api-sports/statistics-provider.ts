import { z } from 'zod';
import type {
  BasketballStatisticsProvider,
  BasketballStatisticsRequest,
} from '../sports/basketball-statistics.js';
import type {
  FootballStatisticsProvider,
  FootballStatisticsRequest,
} from '../sports/football-statistics.js';
import type { ApiSportsClient } from './client.js';
import {
  ApiSportsFixtureMatcher,
  basketballGameSchema,
  footballFixtureSchema,
  type BasketballGame,
  type FootballFixture,
} from './fixture-matcher.js';

const footballList = z.array(footballFixtureSchema);
const basketballList = z.array(basketballGameSchema);
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
  constructor(private readonly client: ApiSportsClient) {
    this.matcher = new ApiSportsFixtureMatcher(client);
  }

  async getSnapshot(request: FootballStatisticsRequest): Promise<unknown> {
    const fixture = await this.matcher.matchFootball(request);
    const [home, away] = await Promise.all([
      this.client.request(
        'football',
        '/fixtures',
        {
          team: fixture.teams.home.id,
          league: fixture.league.id,
          season: fixture.league.season,
          last: 20,
          status: 'FT',
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
          status: 'FT',
        },
        footballList,
        900,
      ),
    ]);
    const homeGames = this.footballGames(home.data, fixture.teams.home.id, 'home');
    const awayGames = this.footballGames(away.data, fixture.teams.away.id, 'away');
    return {
      providerFixtureId: String(fixture.fixture.id),
      providerCompetitionId: String(fixture.league.id),
      season: String(fixture.league.season),
      competition: fixture.league.name,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      startsAt: new Date(fixture.fixture.timestamp * 1000),
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
  constructor(private readonly client: ApiSportsClient) {
    this.matcher = new ApiSportsFixtureMatcher(client);
  }

  async getSnapshot(request: BasketballStatisticsRequest): Promise<unknown> {
    const game = await this.matcher.matchBasketball(request);
    const [home, away] = await Promise.all([
      this.client.request(
        'basketball',
        '/games',
        { team: game.teams.home.id, league: game.league.id, season: game.league.season },
        basketballList,
        900,
      ),
      this.client.request(
        'basketball',
        '/games',
        { team: game.teams.away.id, league: game.league.id, season: game.league.season },
        basketballList,
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
    return {
      providerEventId: String(game.id),
      providerCompetitionId: String(game.league.id),
      competition: game.league.name,
      homeTeam: game.teams.home.name,
      awayTeam: game.teams.away.name,
      startsAt: new Date(game.timestamp * 1000),
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
