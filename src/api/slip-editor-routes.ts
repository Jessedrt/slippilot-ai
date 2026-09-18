import type { FastifyInstance } from 'fastify';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import { chooseVariedMarket, isBasketballUnderPick } from '../sportybet/discovery.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection, NormalizedMarket } from '../types/domain.js';

const selectionSchema = z.object({
  eventId: z.string().min(1).max(100), marketId: z.string().min(1).max(100),
  selectionId: z.string().min(1).max(100), sport: z.enum(['football', 'basketball']),
  league: z.string().max(120), homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().min(1).max(120), startsAt: z.string().datetime(),
  marketName: z.string().min(1).max(160), selectionName: z.string().min(1).max(160),
  odds: z.number().min(1.001).max(1000), confidence: z.number().min(0).max(99),
  risk: z.enum(['lower', 'medium', 'higher']),
});
type Selected = z.infer<typeof selectionSchema>;
const editorSchema = z.object({
  action: z.enum(['replace', 'reanalyze']),
  index: z.number().int().nonnegative().optional(),
  selections: z.array(selectionSchema).min(1).max(60),
  analysisToken: z.string().min(20).max(131_072),
  targetOdds: z.number().finite().min(1.01).optional(),
  riskMode: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
}).refine((value) => value.action !== 'replace' ||
  (value.index !== undefined && value.index < value.selections.length), {
  path: ['index'], message: 'Choose a selection to replace.',
});

class EditConflict extends Error { readonly statusCode = 409; }
const key = (item: Selected) => `${item.eventId}\u0000${item.marketId}\u0000${item.selectionId}`;
const session = (initData: string) => createHash('sha256').update(initData).digest('base64url');

/** Same signed, session-bound token protocol as /api/miniapp/code. */
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
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Date.now() + 30 * 60_000, session: session(initData),
    selections: selections.map(key),
  })).toString('base64url');
  const signature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function registerSlipEditorRoutes(
  app: FastifyInstance,
  deps: { sportyBet: SportyBetProvider; slipAnalyzer: SlipAnalyzer; telegramBotToken?: string },
): void {
  // registerMiniAppRoutes provides Telegram-authentication for /api/miniapp/*.
  app.post('/api/miniapp/edit-slip', async (request, reply) => {
    const input = editorSchema.parse(request.body);
    const initData = request.headers['x-telegram-init-data'];
    if (!deps.telegramBotToken || typeof initData !== 'string' ||
        !verifiedToken(input.analysisToken, input.selections, initData, deps.telegramBotToken)) {
      return reply.unauthorized('Analysis expired or does not match this slip. Build a new slip.');
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
        throw new EditConflict('A fixture has started or is unavailable. Build a fresh slip.');
      }
      const possible = markets.filter((market) => market.providerMarketId === selection.marketId &&
        market.providerSelectionId === selection.selectionId && market.sport === selection.sport);
      if (possible.length !== 1 || possible[0]?.status !== 'active') {
        throw new EditConflict('A selected market is unavailable or ambiguous. Remove it or rebuild.');
      }
      const market = possible[0];
      return {
        ...market,
        fixture: {
          id: event.providerEventId, providerId: event.providerEventId,
          sport: selection.sport, league: event.league || 'Competition not supplied',
          homeTeam: event.homeTeam, awayTeam: event.awayTeam,
          startsAt: event.startsAt, status: event.status,
        },
        modelProbability: 0, confidenceScore: 0, dataQuality: 'medium',
        riskLevel: selection.risk, reasoning: [],
      };
    };
    const original = await Promise.all(input.selections.map(refresh));
    if (input.action === 'replace') {
      const index = input.index!;
      const previous = original[index]!;
      const markets = await getMarkets.get(previous.eventId)!;
      const eligible = markets.filter((market: NormalizedMarket) =>
        market.sport === previous.sport && market.status === 'active' &&
        market.odds > 1.01 && Number.isFinite(market.odds) && market.odds <= 1000 &&
        !isBasketballUnderPick(market) &&
        (market.providerMarketId !== previous.providerMarketId ||
          market.providerSelectionId !== previous.providerSelectionId),
      );
      // Prefer a different market type rather than an opposing outcome in the same market.
      const differentMarket = eligible.filter((market) => market.providerMarketId !== previous.providerMarketId);
      const alternative = chooseVariedMarket(differentMarket.length ? differentMarket : eligible,
        previous.odds, new Map(), new Map());
      if (!alternative) throw new EditConflict('No alternative active market is available for this match. Remove the selection instead.');
      original[index] = { ...alternative, fixture: previous.fixture,
        modelProbability: 0, confidenceScore: 0, dataQuality: 'medium',
        riskLevel: 'medium', reasoning: [] };
    }
    const analysis = await deps.slipAnalyzer.analyze(original);
    const reviews = new Map(analysis.selections.map((item) => [item.index, item]));
    if (reviews.size !== original.length || original.some((_pick, index) => !reviews.has(index + 1))) {
      throw new EditConflict('AI did not review every selection; your original slip is unchanged.');
    }
    if (analysis.selections.some((item) => item.verdict === 'reject')) {
      throw new EditConflict('AI rejected a selection in the edited slip. Remove it or rebuild; your original slip is unchanged.');
    }
    const selections: Selected[] = original.map((pick, index) => {
      const result = reviews.get(index + 1)!;
      return {
        eventId: pick.eventId, marketId: pick.providerMarketId,
        selectionId: pick.providerSelectionId, sport: pick.sport,
        league: pick.fixture.league, homeTeam: pick.fixture.homeTeam,
        awayTeam: pick.fixture.awayTeam, startsAt: pick.fixture.startsAt.toISOString(),
        marketName: pick.marketName, selectionName: pick.selectionName,
        odds: pick.odds, confidence: result.confidence, risk: result.risk,
      };
    });
    return {
      slipId: randomUUID(), sport: selections[0]!.sport,
      riskMode: input.riskMode, targetOdds: input.targetOdds ?? null,
      requestedGames: selections.length, availableGames: selections.length, shortfall: 0,
      schedule: 'refreshed live markets', selections,
      combinedOdds: selections.reduce((total, item) => total * item.odds, 1),
      averageConfidence: selections.reduce((total, item) => total + item.confidence, 0) / selections.length,
      summary: analysis.summary, rejected: 0,
      oddsChanged: selections.some((item, index) => item.odds !== input.selections[index]?.odds),
      analysisToken: signedToken(selections, initData, deps.telegramBotToken!),
    };
  });
}
