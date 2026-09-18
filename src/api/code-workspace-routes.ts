import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';

interface Deps { sportyBet: SportyBetProvider; slipAnalyzer: SlipAnalyzer; telegramBotToken?: string }
const requestSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/) });
const key = (item: { eventId: string; marketId: string; selectionId: string; specifier?: string | null }) => {
  const base = `${item.eventId}\u0000${item.marketId}\u0000${item.selectionId}`;
  return item.specifier == null ? base : `${base}\u0000${item.specifier}`;
};

/** Import only verified current SportyBet identities; never treat the pasted text as a ready bet. */
export async function importBookingCode(code: string, deps: Deps, initData: string) {
  if (!deps.telegramBotToken) throw new Error('Telegram login is not configured.');
  const resolved = await deps.sportyBet.resolveBookingCode(code);
  if (!resolved.length || resolved.length > 60) {
    throw new Error('This code has no supported selections, or exceeds the 60-selection editing limit.');
  }
  const events = new Map<string, ReturnType<SportyBetProvider['getEvent']>>();
  const markets = new Map<string, ReturnType<SportyBetProvider['getMarkets']>>();
  const seen = new Set<string>();
  const candidates = await Promise.all(resolved.map(async (item): Promise<CandidateSelection> => {
    const identity = key(item);
    if (seen.has(identity)) throw new Error('Booking code contains duplicate selections.');
    seen.add(identity);
    if (!events.has(item.eventId)) {
      events.set(item.eventId, deps.sportyBet.getEvent(item.eventId));
      markets.set(item.eventId, deps.sportyBet.getMarkets(item.eventId));
    }
    const [fixture, available] = await Promise.all([events.get(item.eventId)!, markets.get(item.eventId)!]);
    if (!fixture || fixture.status !== 'scheduled' || fixture.startsAt.getTime() <= Date.now()) {
      throw new Error('A fixture in this code has started or is unavailable. It cannot be edited into a new code.');
    }
    const matching = available.filter((market: NormalizedMarket) =>
      market.providerMarketId === item.marketId && market.providerSelectionId === item.selectionId &&
      (item.specifier == null ? market.specifier == null : market.specifier === item.specifier));
    if (matching.length !== 1 || matching[0]?.status !== 'active') {
      throw new Error('A selection cannot be matched to one active market. No editable slip was created.');
    }
    const market = matching[0];
    return { ...market, fixture: { id: fixture.providerEventId, providerId: fixture.providerEventId,
      sport: market.sport, league: fixture.league || 'Competition not supplied',
      homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, startsAt: fixture.startsAt,
      status: fixture.status }, modelProbability: 0, confidenceScore: 0,
      dataQuality: 'medium', riskLevel: 'medium', reasoning: [] };
  }));
  const analysis = await deps.slipAnalyzer.analyze(candidates);
  const reviews = new Map(analysis.selections.map((review) => [review.index, review]));
  if (reviews.size !== candidates.length || candidates.some((_item, index) => !reviews.has(index + 1))) {
    throw new Error('AI did not review every code selection. No editable slip was created.');
  }
  const all = candidates.map((item, index) => {
    const review = reviews.get(index + 1)!;
    return { eventId: item.eventId, marketId: item.providerMarketId,
      selectionId: item.providerSelectionId, sport: item.sport,
      ...(item.specifier != null ? { specifier: item.specifier } : {}),
      homeTeam: item.fixture.homeTeam, awayTeam: item.fixture.awayTeam,
      league: item.fixture.league, startsAt: item.fixture.startsAt.toISOString(),
      marketName: item.marketName, selectionName: item.selectionName,
      odds: item.odds, confidence: Math.max(0, Math.min(99, review.confidence)),
      risk: review.risk, verdict: review.verdict, reason: review.reason };
  });
  const accepted = all.filter((item) => item.verdict !== 'reject');
  const editableSlip = accepted.length ? (() => {
    const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + 30 * 60_000,
      session: createHash('sha256').update(initData).digest('base64url'),
      selections: accepted.map(key) })).toString('base64url');
    const signature = createHmac('sha256', deps.telegramBotToken!)
      .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
    const selections = accepted.map(({ verdict: _verdict, reason: _reason, ...item }) => {
      void _verdict; void _reason;
      return item;
    });
    return { slipId: randomUUID(), sport: accepted[0]!.sport, riskMode: 'balanced' as const,
      targetOdds: null, requestedGames: accepted.length, availableGames: accepted.length,
      shortfall: 0, schedule: 'Imported from verified booking code', selections,
      combinedOdds: selections.reduce((product, item) => product * item.odds, 1),
      averageConfidence: selections.reduce((total, item) => total + item.confidence, 0) / selections.length,
      summary: analysis.summary, rejected: all.length - accepted.length,
      analysisToken: `${payload}.${signature}`, sourceCode: code.toUpperCase() };
  })() : null;
  return { code: code.toUpperCase(), count: all.length,
    combinedOdds: candidates.reduce((product, item) => product * item.odds, 1),
    analyzedAt: analysis.analyzedAt, summary: analysis.summary, selections: all,
    editableSlip, rejected: all.length - accepted.length,
    disclaimer: 'Only AI-reviewed non-rejected selections may be edited. Odds are refreshed before code creation; scores are not win probabilities. No wager was placed.' };
}

export function registerCodeWorkspaceRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/api/miniapp/import-code', async (request) => {
    const { code } = requestSchema.parse(request.body);
    return importBookingCode(code.toUpperCase(), deps,
      request.headers['x-telegram-init-data'] as string);
  });
}
