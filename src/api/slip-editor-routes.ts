import type { FastifyInstance } from 'fastify';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import { MIN_AI_QUALITY_SCORE, passesAiQuality } from '../ai/quality-gate.js';
import { chooseVariedMarket } from '../sportybet/discovery.js';
import { isAllowedBasketballOverMarket } from '../sportybet/basketball-over-markets.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';

const selectionSchema = z.object({
  eventId: z.string().min(1).max(100), marketId: z.string().min(1).max(100),
  selectionId: z.string().min(1).max(100),
  specifier: z.string().max(200).nullable().optional(),
  sport: z.enum(['football', 'basketball', 'tennis', 'handball']), league: z.string().max(120),
  homeTeam: z.string().min(1).max(120), awayTeam: z.string().min(1).max(120),
  startsAt: z.string().datetime(), marketName: z.string().min(1).max(160),
  selectionName: z.string().min(1).max(160), odds: z.number().min(1.001).max(1000),
  confidence: z.number().min(0).max(99), risk: z.enum(['lower', 'medium', 'higher']),
});
type Selected = z.infer<typeof selectionSchema>;
const editorSchema = z.object({
  action: z.enum(['replace', 'choose', 'reanalyze']),
  index: z.number().int().nonnegative().optional(),
  marketId: z.string().min(1).max(100).optional(),
  selectionId: z.string().min(1).max(100).optional(),
  specifier: z.string().max(200).nullable().optional(),
  selections: z.array(selectionSchema).min(1).max(60),
  analysisToken: z.string().min(20).max(131_072),
  targetOdds: z.number().finite().min(1.01).optional(),
  riskMode: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
}).refine((value) => value.action === 'reanalyze' ||
  (value.index !== undefined && value.index < value.selections.length &&
    (value.action !== 'choose' || Boolean(value.marketId && value.selectionId))), {
  path: ['index'], message: 'Select a valid selection and active replacement market.',
});

class EditConflict extends Error { readonly statusCode = 409; }
const key = (item: Selected) => {
  const base = `${item.eventId}\u0000${item.marketId}\u0000${item.selectionId}`;
  return item.specifier == null ? base : `${base}\u0000${item.specifier}`;
};
const session = (initData: string) => createHash('sha256').update(initData).digest('base64url');
function verifiedToken(token: string, selections: Selected[], initData: string, botToken: string): boolean {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const claim = z.object({ expiresAt: z.number(), session: z.string(),
      selections: z.array(z.string()) }).parse(data);
    const approved = new Set(claim.selections);
    return claim.expiresAt >= Date.now() && claim.session === session(initData) &&
      selections.every((item) => approved.has(key(item)));
  } catch { return false; }
}
function signedToken(selections: Selected[], initData: string, botToken: string): string {
  const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + 30 * 60_000,
    session: session(initData), selections: selections.map(key) })).toString('base64url');
  const signature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function registerSlipEditorRoutes(
  app: FastifyInstance,
  deps: { sportyBet: SportyBetProvider; slipAnalyzer: SlipAnalyzer; telegramBotToken?: string },
): void {
  app.post('/api/miniapp/edit-slip', async (request, reply) => {
    const input = editorSchema.parse(request.body);
    const initData = request.headers['x-telegram-init-data'];
    if (!deps.telegramBotToken || typeof initData !== 'string' ||
        !verifiedToken(input.analysisToken, input.selections, initData, deps.telegramBotToken)) {
      return reply.unauthorized('Analysis expired or does not match this slip. Analyze the code or rebuild.');
    }
    const getEvent = new Map<string, ReturnType<SportyBetProvider['getEvent']>>();
    const getMarkets = new Map<string, ReturnType<SportyBetProvider['getMarkets']>>();
    const refresh = async (selection: Selected): Promise<CandidateSelection> => {
      if (!getEvent.has(selection.eventId)) {
        getEvent.set(selection.eventId, deps.sportyBet.getEvent(selection.eventId));
        getMarkets.set(selection.eventId, deps.sportyBet.getMarkets(selection.eventId));
      }
      const [event, markets] = await Promise.all([
        getEvent.get(selection.eventId)!, getMarkets.get(selection.eventId)!,
      ]);
      if (!event || event.status !== 'scheduled' || event.startsAt.getTime() <= Date.now()) {
        throw new EditConflict('A fixture has started or is unavailable. Import or build a fresh slip.');
      }
      const possible = markets.filter((market) => market.providerMarketId === selection.marketId &&
        market.providerSelectionId === selection.selectionId && market.sport === selection.sport &&
        (selection.specifier == null ? market.specifier == null : market.specifier === selection.specifier));
      if (possible.length !== 1 || possible[0]?.status !== 'active') {
        throw new EditConflict('A selected market is unavailable or ambiguous. Remove it or rebuild.');
      }
      const market = possible[0];
      return { ...market,
        fixture: { id: event.providerEventId, providerId: event.providerEventId,
          sport: selection.sport, league: event.league || 'Competition not supplied',
          homeTeam: event.homeTeam, awayTeam: event.awayTeam,
          startsAt: event.startsAt, status: event.status },
        modelProbability: 0, confidenceScore: 0, dataQuality: 'medium',
        riskLevel: selection.risk, reasoning: [] };
    };
    const original = await Promise.all(input.selections.map(refresh));
    if (input.action !== 'reanalyze') {
      const index = input.index!;
      const previous = original[index]!;
      const markets = await getMarkets.get(previous.eventId)!;
      const eligible = markets.filter((market: NormalizedMarket) =>
        market.sport === previous.sport && market.status === 'active' &&
        (previous.sport !== 'basketball' || isAllowedBasketballOverMarket(market)) &&
        market.odds > 1.01 && Number.isFinite(market.odds) && market.odds <= 1000 &&
        (market.providerMarketId !== previous.providerMarketId ||
          market.providerSelectionId !== previous.providerSelectionId ||
          (market.specifier ?? null) !== (previous.specifier ?? null)),
      );
      let alternative: NormalizedMarket | null = null;
      if (input.action === 'choose') {
        const matches = eligible.filter((market) => market.providerMarketId === input.marketId &&
          market.providerSelectionId === input.selectionId &&
          (input.specifier == null ? market.specifier == null : market.specifier === input.specifier));
        if (matches.length === 1) alternative = matches[0]!;
      } else {
        const different = eligible.filter((market) => market.providerMarketId !== previous.providerMarketId);
        alternative = chooseVariedMarket(different.length ? different : eligible,
          previous.odds, new Map(), new Map());
      }
      if (!alternative) throw new EditConflict('That replacement market is not currently available. The original slip is unchanged.');
      if (original.some((selection, position) => position !== index &&
        selection.eventId === alternative.eventId &&
        selection.providerMarketId === alternative.providerMarketId &&
        selection.providerSelectionId === alternative.providerSelectionId &&
        (selection.specifier ?? null) === (alternative.specifier ?? null))) {
        throw new EditConflict('That market is already in the slip. Choose another outcome.');
      }
      original[index] = { ...alternative, fixture: previous.fixture,
        modelProbability: 0, confidenceScore: 0, dataQuality: 'medium',
        riskLevel: 'medium', reasoning: [] };
    }
    const analysis = await deps.slipAnalyzer.analyze(original);
    const reviews = new Map(analysis.selections.map((item) => [item.index, item]));
    if (reviews.size !== original.length || original.some((_pick, index) => !reviews.has(index + 1))) {
      throw new EditConflict('AI did not review every selection; the original slip is unchanged.');
    }
    const failed = analysis.selections.filter((item) => !passesAiQuality(item));
    if (failed.length) {
      const numbers = failed.map((item) => `#${item.index}`).join(', ');
      throw new EditConflict(`Selection(s) ${numbers} did not meet the ${MIN_AI_QUALITY_SCORE}/100 AI quality pass mark or were rejected. Remove or replace them and reanalyze. The original slip is unchanged; no code was created.`);
    }
    const selections: Selected[] = original.map((pick, index) => {
      const review = reviews.get(index + 1)!;
      return { eventId: pick.eventId, marketId: pick.providerMarketId,
        selectionId: pick.providerSelectionId,
        ...(pick.specifier != null ? { specifier: pick.specifier } : {}),
        sport: pick.sport, league: pick.fixture.league,
        homeTeam: pick.fixture.homeTeam, awayTeam: pick.fixture.awayTeam,
        startsAt: pick.fixture.startsAt.toISOString(),
        marketName: pick.marketName, selectionName: pick.selectionName,
        odds: pick.odds, confidence: Math.max(0, Math.min(99, review.confidence)), risk: review.risk };
    });
    return { slipId: randomUUID(), sport: selections[0]!.sport,
      riskMode: input.riskMode, targetOdds: input.targetOdds ?? null,
      requestedGames: selections.length, availableGames: selections.length, shortfall: 0,
      schedule: 'Refreshed provider markets', selections,
      combinedOdds: selections.reduce((total, item) => total * item.odds, 1),
      averageConfidence: selections.reduce((total, item) => total + item.confidence, 0) / selections.length,
      summary: `AI pass mark ${MIN_AI_QUALITY_SCORE}/100 (quality, not win probability). ${analysis.summary}`, rejected: 0,
      oddsChanged: selections.some((item, index) => item.odds !== input.selections[index]?.odds),
      analysisToken: signedToken(selections, initData, deps.telegramBotToken) };
  });
}
