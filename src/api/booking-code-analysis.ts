import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';

interface AnalysisDeps {
  sportyBet: SportyBetProvider;
  slipAnalyzer: SlipAnalyzer;
}

const requestSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/) });

/** Resolves the actual bookmaker fixtures and selections before asking AI to review them.
 * A code alone, an odds total or invented team details must never be labelled an analysis. */
export async function analyzeBookingCode(code: string, deps: AnalysisDeps) {
  const resolved = await deps.sportyBet.resolveBookingCode(code);
  if (!resolved.length) throw new Error('This booking code contains no selections to analyze.');
  const eventRequests = new Map<string, ReturnType<SportyBetProvider['getEvent']>>();
  const marketRequests = new Map<string, ReturnType<SportyBetProvider['getMarkets']>>();
  const candidates = await Promise.all(resolved.map(async (pick): Promise<CandidateSelection> => {
    if (!eventRequests.has(pick.eventId)) {
      eventRequests.set(pick.eventId, deps.sportyBet.getEvent(pick.eventId));
      marketRequests.set(pick.eventId, deps.sportyBet.getMarkets(pick.eventId));
    }
    const [event, markets] = await Promise.all([
      eventRequests.get(pick.eventId)!,
      marketRequests.get(pick.eventId)!,
    ]);
    if (!event) throw new Error('One of this code’s fixtures is no longer available. Full analysis cannot be verified.');
    const matching = markets.filter((market: NormalizedMarket) =>
      market.providerMarketId === pick.marketId &&
      market.providerSelectionId === pick.selectionId &&
      (pick.specifier == null || (market.specifier ?? null) === pick.specifier),
    );
    // An absent or ambiguous market must fail rather than silently inventing an analysis.
    if (matching.length !== 1) {
      throw new Error('A selection in this code could not be matched to a unique live market. Try a current code.');
    }
    const market = matching[0]!;
    return {
      ...market,
      fixture: {
        id: event.providerEventId,
        providerId: event.providerEventId,
        sport: market.sport,
        league: event.league || 'League not supplied',
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        startsAt: event.startsAt,
        status: event.status,
      },
      // No invented pre-analysis probability or evidence-quality score.
      modelProbability: 0,
      confidenceScore: 0,
      dataQuality: 'medium',
      riskLevel: 'medium',
      reasoning: [],
    };
  }));
  const analysis = await deps.slipAnalyzer.analyze(candidates);
  const byIndex = new Map(analysis.selections.map((item) => [item.index, item]));
  if (byIndex.size !== candidates.length || candidates.some((_item, index) => !byIndex.has(index + 1))) {
    throw new Error('AI did not assess every selection. Please try again.');
  }
  const selections = candidates.map((pick, index) => {
    const review = byIndex.get(index + 1)!;
    return {
      homeTeam: pick.fixture.homeTeam,
      awayTeam: pick.fixture.awayTeam,
      league: pick.fixture.league,
      startsAt: pick.fixture.startsAt.toISOString(),
      marketName: pick.marketName,
      selectionName: pick.selectionName,
      odds: pick.odds,
      status: pick.status,
      eventStatus: pick.fixture.status,
      confidence: review.confidence,
      risk: review.risk,
      verdict: review.verdict,
      reason: review.reason,
    };
  });
  return {
    code: code.toUpperCase(),
    count: selections.length,
    combinedOdds: candidates.reduce((total, pick) => total * pick.odds, 1),
    summary: analysis.summary,
    analyzedAt: analysis.analyzedAt,
    selections,
    disclaimer: 'AI quality scores are not winning probabilities. Odds and availability may change; no bet was placed.',
  };
}

export function registerBookingCodeAnalysisRoute(app: FastifyInstance, deps: AnalysisDeps): void {
  // registerMiniAppRoutes installs the shared Telegram init-data preHandler first.
  app.post('/api/miniapp/analyze-code', async (request, reply) => {
    const { code } = requestSchema.parse(request.body);
    try {
      return await analyzeBookingCode(code.toUpperCase(), deps);
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes('no selections') ||
        error.message.includes('no longer available') ||
        error.message.includes('unique live market')
      )) {
        return reply.status(422).send({ message: error.message });
      }
      throw error;
    }
  });
}
