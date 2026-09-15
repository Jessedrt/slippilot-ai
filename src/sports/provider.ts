import type { Fixture, Sport } from '../types/domain.js';

export interface FixtureQuery {
  sport: Sport;
  from: Date;
  to: Date;
  league?: string;
}

export interface SportsProvider {
  readonly name: string;
  getFixtures(query: FixtureQuery): Promise<Fixture[]>;
  getEvent(eventId: string): Promise<Fixture | null>;
  getTeamStats(teamId: string): Promise<unknown>;
  getRecentForm(teamId: string): Promise<unknown>;
  getHeadToHead(homeTeamId: string, awayTeamId: string): Promise<unknown>;
  getStandings(leagueId: string): Promise<unknown>;
  getInjuries(eventId: string): Promise<unknown>;
  getLineups(eventId: string): Promise<unknown>;
  getPlayerStats(playerId: string): Promise<unknown>;
  health(): Promise<{ ok: boolean; detail: string }>;
}

export class DisabledSportsProvider implements SportsProvider {
  readonly name = 'disabled';
  private unavailable(): Error {
    return new Error('Sports provider is not configured; current statistics cannot be refreshed.');
  }
  getFixtures(): Promise<Fixture[]> {
    return Promise.resolve([]);
  }
  getEvent(): Promise<Fixture | null> {
    return Promise.resolve(null);
  }
  getTeamStats(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  getRecentForm(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  getHeadToHead(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  getStandings(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  getInjuries(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  getLineups(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  getPlayerStats(): Promise<unknown> {
    return Promise.reject(this.unavailable());
  }
  health(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: false, detail: 'Not configured' });
  }
}
