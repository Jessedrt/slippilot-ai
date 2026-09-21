import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import { passesAiQuality } from '../ai/quality-gate.js';
import { minimumQualityForTarget } from '../ai/quality-policy.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';

interface Deps { sportyBet: SportyBetProvider; slipAnalyzer: SlipAnalyzer; telegramBotToken?: string }
const requestSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9]{4,20}$/) });
const key = (item: { eventId: string; marketId: string; selectionId: string; specifier?: string | null }) => {
  const base = `${item.eventId}\u0000${item.marketId}\u0000${item.selectionId}`;
  return item.specifier == null ? base : `${base}\u0000${item.specifier}`;
};
class ImportConflict extends Error { readonly statusCode = 409; }
interface ExcludedLeg { index: number; eventId: string; label: string; reason: string }
type CheckedLeg = { candidate: CandidateSelection; excluded?: never } |
  { candidate?: never; excluded: ExcludedLeg };

/** Analyze the verified, still editable portion of a code. Expired legs are named and
 * excluded, never treated as active choices, and the original code is unchanged. */
export async function importBookingCode(code: string, deps: Deps, initData: string) {
  if (!deps.telegramBotToken) throw new ImportConflict('Telegram login is not configured. Open AUREX from its bot.');
  const resolved = await deps.sportyBet.resolveBookingCode(code);
  if (!resolved.length || resolved.length > 60) {
    throw new ImportConflict('This code has no supported selections, or exceeds the 60-selection editing limit.');
  }
  const events = new Map<string, ReturnType<SportyBetProvider['getEvent']>>();
  const markets = new Map<string, ReturnType<SportyBetProvider['getMarkets']>>();
  const seen = new Set<string>();
  const checked: CheckedLeg[] = await Promise.all(resolved.map(async (item, index): Promise<CheckedLeg> => {
    const identity = key(item);
    if (seen.has(identity)) throw new ImportConflict('Booking code contains duplicate selections.');
    seen.add(identity);
    if (!events.has(item.eventId)) {
      events.set(item.eventId, deps.sportyBet.getEvent(item.eventId));
      markets.set(item.eventId, deps.sportyBet.getMarkets(item.eventId));
    }
    // Provider/network errors intentionally propagate. We must not pass off an outage as an expired leg.
    const [fixture, available] = await Promise.all([events.get(item.eventId)!, markets.get(item.eventId)!]);
    const label = fixture ? `${fixture.homeTeam} vs ${fixture.awayTeam}` : `Fixture ${item.eventId}`;
    if (!fixture || fixture.status !== 'scheduled' || fixture.startsAt.getTime() <= Date.now()) {
      return { excluded: { index: index + 1, eventId: item.eventId, label,
        reason: 'Already started, finished or unavailable; excluded from editing.' } };
    }
    const matching = available.filter((market: NormalizedMarket) =>
      market.providerMarketId === item.marketId && market.providerSelectionId === item.selectionId &&
      (item.specifier == null ? market.specifier == null : market.specifier === item.specifier));
    if (matching.length !== 1 || matching[0]?.status !== 'active') {
      return { excluded: { index: index + 1, eventId: item.eventId, label,
        reason: 'No unique active matching market; excluded from editing.' } };
    }
    const market = matching[0];
    return { candidate: { ...market, fixture: { id: fixture.providerEventId, providerId: fixture.providerEventId,
      sport: market.sport, league: fixture.league || 'Competition not supplied',
      homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, startsAt: fixture.startsAt,
      status: fixture.status }, modelProbability: 0, confidenceScore: 0,
      dataQuality: 'medium', riskLevel: 'medium', reasoning: [] } };
  }));
  const candidates = checked.flatMap((item) => item.candidate ? [item.candidate] : []);
  const excluded = checked.flatMap((item) => item.excluded ? [item.excluded] : []);
  if (!candidates.length) {
    throw new ImportConflict(`This code has ${excluded.length} expired or unavailable selection(s) and no current market to analyze or edit. Try a booking code with upcoming fixtures.`);
  }
  const analysis = await deps.slipAnalyzer.analyze(candidates);
  const reviews = new Map(analysis.selections.map((review) => [review.index, review]));
  if (reviews.size !== candidates.length || candidates.some((_item, index) => !reviews.has(index + 1))) {
    throw new ImportConflict('AI did not review every current code selection. No editable slip was created.');
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
  }).sort((left, right) => right.confidence - left.confidence);
  // An imported, unspecified target is a balanced non-preset. It cannot claim 2.00/5.00
  // simply because the original combined odds happened to be close to those values.
  const minimum = minimumQualityForTarget(undefined, 'balanced');
  const accepted = all.filter((item) => passesAiQuality(item, minimum));
  const editableSlip = accepted.length ? (() => {
    const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + 30 * 60_000,
      session: createHash('sha256').update(initData).digest('base64url'),
      selections: accepted.map(key), minimumScore: minimum })).toString('base64url');
    const signature = createHmac('sha256', deps.telegramBotToken)
      .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
    const selections = accepted.map(({ verdict: _verdict, reason: _reason, ...item }) => {
      void _verdict; void _reason;
      return item;
    });
    return { slipId: randomUUID(), sport: accepted[0]!.sport, riskMode: 'balanced' as const,
      targetOdds: null, qualityMinimum: minimum, requestedGames: accepted.length,
      availableGames: accepted.length, shortfall: 0,
      schedule: 'Imported from verified booking code', selections,
      combinedOdds: selections.reduce((product, item) => product * item.odds, 1),
      averageConfidence: selections.reduce((total, item) => total + item.confidence, 0) / selections.length,
      summary: analysis.summary, rejected: all.length - accepted.length,
      analysisToken: `${payload}.${signature}`, sourceCode: code.toUpperCase() };
  })() : null;
  return { code: code.toUpperCase(), count: resolved.length,
    analyzedCount: all.length, excluded,
    combinedOdds: candidates.reduce((product, item) => product * item.odds, 1),
    analyzedAt: analysis.analyzedAt,
    summary: `${excluded.length ? `${excluded.length} unavailable/started selections excluded. ` : ''}${analysis.summary}`,
    selections: all, editableSlip, rejected: all.length - accepted.length,
    disclaimer: `Only AI-reviewed selections scoring at least ${minimum}/100 without rejection may be edited. ${excluded.length} expired/unavailable selections were excluded. Ranked scores measure evidence quality, not win probability. Odds are refreshed before code creation; no wager was placed.` };
}

export function registerCodeWorkspaceRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/api/miniapp/import-code', async (request) => {
    const { code } = requestSchema.parse(request.body);
    return importBookingCode(code.toUpperCase(), deps,
      request.headers['x-telegram-init-data'] as string);
  });
}
