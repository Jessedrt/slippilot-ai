import type { Fixture } from '../types/domain.js';
import { normalizeSportsResearch } from '../you/normalizer.js';
import type { SportsResearchResult, YouSearchItem } from '../you/types.js';
import type { WebResearchProvider } from '../you/provider.js';
import type { ResearchSnapshotStore } from './store.js';

export type ResearchTrigger =
  | 'injury_uncertainty' | 'lineup_uncertainty' | 'coaching_change' | 'suspension'
  | 'schedule_congestion' | 'travel_issue' | 'player_availability' | 'postponement'
  | 'major_news' | 'user_requested';

export class SportsResearchService {
  constructor(
    private readonly provider: WebResearchProvider,
    private readonly maximumSources = 8,
    private readonly store?: ResearchSnapshotStore,
  ) {}

  async researchFixture(fixture: Fixture, triggers: ResearchTrigger[]): Promise<SportsResearchResult> {
    if (triggers.length === 0) return this.skipped();
    const query = [
      fixture.homeTeam, 'vs', fixture.awayTeam, fixture.league,
      'latest injuries suspensions expected lineups team news player availability schedule travel postponement',
    ].join(' ');
    try {
      if (triggers.length >= 3) {
        const response = await this.provider.research(query);
        const result = normalizeSportsResearch(response.output.content, response.output.sources, this.maximumSources);
        await this.persist(fixture.id, query, result);
        return result;
      }
      const response = await this.provider.search(query);
      const items = [...response.results.web, ...response.results.news];
      const result = normalizeSportsResearch(this.summarize(items), items, this.maximumSources);
      await this.persist(fixture.id, query, result);
      return result;
    } catch {
      return this.unavailable();
    }
  }

  async researchTeam(team: string): Promise<SportsResearchResult> {
    const fixture: Fixture = {
      id: `research:${team}`, sport: 'football', league: 'unknown', homeTeam: team,
      awayTeam: 'upcoming opponent', startsAt: new Date(), status: 'scheduled',
    };
    return this.researchFixture(fixture, ['user_requested']);
  }

  private summarize(items: YouSearchItem[]): string {
    if (!items.length) return 'No credible fresh team-news result was found.';
    return items.slice(0, 4).map((item) => item.description ?? item.snippets[0] ?? item.title).join(' ');
  }

  private skipped(): SportsResearchResult {
    return { summary: 'Fresh web research was not needed for this calculation.', sources: [], freshness: 'unknown', confidence: 0, searchedAt: new Date(), conflicting: false, status: 'skipped' };
  }

  private unavailable(): SportsResearchResult {
    return { summary: 'Fresh web research is temporarily unavailable. Analysis is based on structured sports data and current markets.', sources: [], freshness: 'unknown', confidence: 0, searchedAt: new Date(), conflicting: false, status: 'unavailable' };
  }

  private async persist(fixtureId: string, query: string, result: SportsResearchResult): Promise<void> {
    if (!this.store || fixtureId.startsWith('research:')) return;
    try {
      await this.store.save(fixtureId, query, result);
    } catch {
      // Research remains usable if optional citation persistence is temporarily unavailable.
    }
  }
}
