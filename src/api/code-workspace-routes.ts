import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import { minimumAiQualityScore, passesAiQuality } from '../ai/quality-gate.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';

interface Deps { sportyBet: SportyBetProvider; slipAnalyzer: SlipAnalyzer; telegramBotToken?: string }
const requestSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/) });
const key = (item: { eventId: string; marketId: string; selectionId: string; specifier?: string | null }) => {
  const base = `${item.eventId}\u0000${item.marketId}\u0000${item.selectionId}`;
  return item.specifier == null ? base : `${base}\u0000${item.specifier}`;
};
class ImportConflict extends Error {
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = 'ImportConflict'; }
}
interface SkippedSelection { eventId: string; fixture: string; reason: string }

/** Only live, uniquely matched selections enter the editable slip. An old code may
 * still be partly useful: report excluded fixtures rather than responding with 500.
 * Excluded legs never enter the new booking code or signed AI approval token.
 */
export async function importBookingCode(code: string, deps: Deps, initData: string) {
  if (!deps.telegramBotToken) throw new ImportConflict('Telegram login is not configured. Open AUREX from the correct Telegram bot.');
  const resolved = await deps.sportyBet.resolveBookingCode(code);
  if (!resolved.length || resolved.length > 60) {
    throw new ImportConflict('This code has no supported selections, or exceeds the 60-selection editing limit.');
  }
  const events = new Map<string, ReturnType<SportyBetProvider['getEvent']>>();
  const markets = new Map<string, ReturnType<SportyBetProvider['getMarkets']>>();
  const seen = new Set<string>();
  const reviewed = await Promise.all(resolved.map(async (item): Promise<
    { candidate: CandidateSelection; skipped?: never } |
    { candidate?: never; skipped: SkippedSelection }
  > => {
    const identity = key(item);
    if (seen.has(identity)) throw new ImportConflict('Booking code contains duplicate selections.');
    seen.add(identity);
    if (!events.has(item.eventId)) {
      events.set(item.eventId, deps.sportyBet.getEvent(item.eventId));
      markets.set(item.eventId, deps.sportyBet.getMarkets(item.eventId));
    }
    const [fixture, available] = await Promise.all([events.get(item.eventId)!, markets.get(item.eventId)!]);
    const fixtureName = fixture ? `${fixture.homeTeam} vs ${fixture.awayTeam}` : `Event ${item.eventId}`;
    if (!fixture || fixture.status !== 'scheduled' || fixture.startsAt.getTime() <= Date.now()) {
      return { skipped: { eventId: item.eventId, fixture: fixtureName,
        reason: 'Already started, ended or not available for a new code.' } };
    }
    const matching = available.filter((market: NormalizedMarket) =>
      market.providerMarketId === item.marketId && market.providerSelectionId === item.selectionId &&
      (item.specifier == null ? market.specifier == null : market.specifier === item.specifier));
    if (matching.length !== 1 || matching[0]?.status !== 'active') {
      return { skipped: { eventId: item.eventId, fixture: fixtureName,
        reason: 'The original market is no longer uniquely available.' } };
    }
    const market = matching[0];
    return { candidate: { ...market, fixture: { id: fixture.providerEventId, providerId: fixture.providerEventId,
      sport: market.sport, league: fixture.league || 'Competition not supplied',
      homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, startsAt: fixture.startsAt,
      status: fixture.status }, modelProbability: 0, confidenceScore: 0,
      dataQuality: 'medium', riskLevel: 'medium', reasoning: [] } };
  }));
  const excluded = reviewed.flatMap((item) => item.skipped ? [item.skipped] : []);
  const candidates = reviewed.flatMap((item) => item.candidate ? [item.candidate] : []);
  if (!candidates.length) throw new ImportConflict(
    `All ${resolved.length} selections in this code have started or are unavailable for an editable new code. Use a code with upcoming, active fixtures. Nothing was booked.`);
  const analysis = await deps.slipAnalyzer.analyze(candidates);
  const reviews = new Map(analysis.selections.map((review) => [review.index, review]));
  if (reviews.size !== candidates.length || candidates.some((_item, index) => !reviews.has(index + 1))) {
    throw new ImportConflict('AI did not review every available code selection. No editable slip was created.');
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
  const minimumScore = minimumAiQualityScore(null, 'balanced');
  const accepted = all.filter((item) => passesAiQuality(item, minimumScore));
  const editableSlip = accepted.length ? (() => {
    const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + 30 * 60_000,
      session: createHash('sha256').update(initData).digest('base64url'),
      selections: accepted.map(key), minimumScore,
      scores: accepted.map((item) => item.confidence) })).toString('base64url');
    const signature = createHmac('sha256', deps.telegramBotToken)
      .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
    const selections = accepted.map(({ verdict: _verdict, reason: _reason, ...item }) => {
      void _verdict; void _reason;
      return item;
    });
    return { slipId: randomUUID(), sport: accepted[0]!.sport, riskMode: 'balanced' as const,
      targetOdds: null, minimumQualityScore: minimumScore,
      requestedGames: accepted.length, availableGames: accepted.length,
      shortfall: 0, schedule: 'Imported from verified booking code', selections,
      combinedOdds: selections.reduce((product, item) => product * item.odds, 1),
      averageConfidence: selections.reduce((total, item) => total + item.confidence, 0) / selections.length,
      summary: analysis.summary, rejected: all.length - accepted.length,
      analysisToken: `${payload}.${signature}`, sourceCode: code.toUpperCase() };
  })() : null;
  return { code: code.toUpperCase(), count: all.length, originalCount: resolved.length,
    excluded,
    combinedOdds: candidates.reduce((product, item) => product * item.odds, 1),
    analyzedAt: analysis.analyzedAt, summary: analysis.summary, selections: all,
    editableSlip, rejected: all.length - accepted.length, minimumQualityScore: minimumScore,
    disclaimer: `${excluded.length ? `${excluded.length} outdated/unavailable selection(s) excluded; only remaining active picks were analyzed. ` : ''}Only AI-reviewed selections scoring at least ${minimumScore}/100 without rejection may be edited. This is a quality threshold, not a win probability. Odds are refreshed before code creation; no wager was placed.` };
}

export function registerCodeWorkspaceRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/api/miniapp/import-code', async (request) => {
    const { code } = requestSchema.parse(request.body);
    return importBookingCode(code.toUpperCase(), deps,
      request.headers['x-telegram-init-data'] as string);
  });
}
