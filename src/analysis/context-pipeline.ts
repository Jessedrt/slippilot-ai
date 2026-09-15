import type { ResearchTrigger, SportsResearchService } from '../research/sports-research.js';
import type { SportsProvider } from '../sports/provider.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { Fixture, NormalizedMarket } from '../types/domain.js';
import type { SportsResearchResult } from '../you/types.js';

export interface AnalysisContext {
  fixture: Fixture;
  structured: { event: Fixture | null; injuries: unknown; lineups: unknown };
  markets: NormalizedMarket[];
  research: SportsResearchResult;
}

/** Assembles evidence for the primary LLM; it does not replace statistical analysis or reasoning. */
export class AnalysisContextPipeline {
  constructor(
    private readonly sports: SportsProvider,
    private readonly sportyBet: SportyBetProvider,
    private readonly research: SportsResearchService,
  ) {}

  async assemble(fixture: Fixture, triggers: ResearchTrigger[] = []): Promise<AnalysisContext> {
    const eventId = fixture.providerId ?? fixture.id;
    const [event, injuries, lineups, markets, research] = await Promise.all([
      this.sports.getEvent(eventId).catch(() => null),
      this.sports.getInjuries(eventId).catch(() => null),
      this.sports.getLineups(eventId).catch(() => null),
      this.sportyBet.getMarkets(eventId).catch(() => []),
      this.research.researchFixture(fixture, triggers),
    ]);
    return { fixture, structured: { event, injuries, lineups }, markets, research };
  }
}
