import type { FastifyInstance } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import type { ScreenshotAnalyzer } from '../ai/screenshot-analyzer.js';
import { SportyBetSlipBuilder } from '../booking/workflow.js';
import { automaticLegCount } from '../slips/odds-target.js';
import { buildLiveSlipSnapshot } from '../sportybet/discovery.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection } from '../types/domain.js';
import { XPostReader } from '../social/x-post-reader.js';

export interface MiniAppDependencies {
  sportyBet: SportyBetProvider;
  slipAnalyzer: SlipAnalyzer;
  screenshotAnalyzer: ScreenshotAnalyzer;
  telegramBotToken?: string;
}

const buildSchema = z.object({
  sport: z.enum(['football', 'basketball', 'tennis', 'handball']),
  gameCount: z.number().int().positive().safe().optional(),
  targetOdds: z.number().finite().min(1.01).optional(),
  todayOnly: z.boolean().optional().default(true),
  riskMode: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
}).refine((input) => input.targetOdds !== undefined || input.gameCount !== undefined, {
  message: 'Enter target odds of at least 1.01.', path: ['targetOdds'],
});

const selectionSchema = z.object({
  eventId: z.string().min(1).max(100), marketId: z.string().min(1).max(100),
  selectionId: z.string().min(1).max(100),
  specifier: z.string().max(200).nullable().optional(),
  sport: z.enum(['football', 'basketball', 'tennis', 'handball']),
  league: z.string().max(120), homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().min(1).max(120), startsAt: z.string().datetime(),
  marketName: z.string().min(1).max(160), selectionName: z.string().min(1).max(160),
  odds: z.number().min(1.001).max(1000), confidence: z.number().min(0).max(99),
  risk: z.enum(['lower', 'medium', 'higher']),
});
const codeSchema = z.object({
  selections: z.array(selectionSchema).min(1),
  analysisToken: z.string().min(20).max(131_072),
  acceptOddsChange: z.boolean().optional(),
});
type MiniSelection = z.infer<typeof selectionSchema>;
const ANALYSIS_TOKEN_TTL_MS = 30 * 60 * 1000;
interface AnalysisTokenPayload { expiresAt: number; session: string; selections: string[] }

function selectionKey(selection: MiniSelection): string {
  const identity = `${selection.eventId}\u0000${selection.marketId}\u0000${selection.selectionId}`;
  return selection.specifier == null ? identity : `${identity}\u0000${selection.specifier}`;
}
function sessionKey(initData: string): string {
  return createHash('sha256').update(initData).digest('base64url');
}
function signAnalysisToken(selections: MiniSelection[], initData: string, botToken: string): string {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: Date.now() + ANALYSIS_TOKEN_TTL_MS,
    session: sessionKey(initData), selections: selections.map(selectionKey),
  } satisfies AnalysisTokenPayload)).toString('base64url');
  const signature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyAnalysisToken(token: string, selections: MiniSelection[], initData: string, botToken: string): boolean {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return false;
  const expectedSignature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AnalysisTokenPayload;
    if (claim.expiresAt < Date.now() || claim.session !== sessionKey(initData)) return false;
    const approved = new Set(claim.selections);
    return selections.every((selection) => approved.has(selectionKey(selection)));
  } catch { return false; }
}
function toCandidate(selection: MiniSelection): CandidateSelection {
  return {
    providerMarketId: selection.marketId, providerSelectionId: selection.selectionId,
    ...(selection.specifier != null ? { specifier: selection.specifier } : {}),
    eventId: selection.eventId, sport: selection.sport, category: 'mini-app',
    marketName: selection.marketName, selectionName: selection.selectionName,
    odds: selection.odds, status: 'active', lastUpdated: new Date(),
    fixture: {
      id: selection.eventId, providerId: selection.eventId, sport: selection.sport,
      league: selection.league, homeTeam: selection.homeTeam, awayTeam: selection.awayTeam,
      startsAt: new Date(selection.startsAt), status: 'scheduled',
    },
    modelProbability: selection.confidence, confidenceScore: selection.confidence,
    dataQuality: 'medium', riskLevel: selection.risk,
    reasoning: ['AI-reviewed in the AUREX Mini App.'],
  };
}
function verifyTelegramInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!suppliedHash || !Number.isFinite(authDate)) return false;
  if (Math.abs(Date.now() / 1000 - authDate) > 86_400) return false;
  params.delete('hash');
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest('hex');
  const supplied = Buffer.from(suppliedHash, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return supplied.length === expectedBytes.length && timingSafeEqual(supplied, expectedBytes);
}

export function registerMiniAppRoutes(app: FastifyInstance, deps: MiniAppDependencies): void {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/miniapp/')) return;
    if (!deps.telegramBotToken) return reply.serviceUnavailable('Mini App is not configured.');
    const initData = request.headers['x-telegram-init-data'];
    if (typeof initData !== 'string' || !verifyTelegramInitData(initData, deps.telegramBotToken)) {
      return reply.unauthorized('Open AUREX through its Telegram Mini App launcher.');
    }
  });
  app.post('/api/miniapp/build', async (request, reply) => {
    const input = buildSchema.parse(request.body);
    const plannedGames = input.targetOdds === undefined ? input.gameCount! :
      automaticLegCount(input.targetOdds, input.riskMode);
    const snapshot = await buildLiveSlipSnapshot(
      deps.sportyBet, input.sport, plannedGames, input.targetOdds, input.todayOnly,
    );
    const analysis = await deps.slipAnalyzer.analyze(snapshot.slip.selections);
    const selections = snapshot.slip.selections.flatMap((selection, index) => {
      const result = analysis.selections[index];
      if (!result || result.verdict === 'reject') return [];
      return [{
        eventId: selection.eventId, marketId: selection.providerMarketId,
        selectionId: selection.providerSelectionId,
        ...(selection.specifier != null ? { specifier: selection.specifier } : {}),
        sport: selection.sport, league: selection.fixture.league,
        homeTeam: selection.fixture.homeTeam, awayTeam: selection.fixture.awayTeam,
        startsAt: selection.fixture.startsAt.toISOString(),
        marketName: selection.marketName, selectionName: selection.selectionName,
        odds: selection.odds, confidence: result.confidence, risk: result.risk,
        verdict: result.verdict,
      }];
    });
    if (!selections.length) return reply.conflict('AI rejected every available selection.');
    const initData = request.headers['x-telegram-init-data'] as string;
    const dayLabel = ['today', 'tomorrow', 'the following day'][snapshot.dayOffset];
    return {
      slipId: snapshot.slip.id, sport: input.sport, riskMode: input.riskMode,
      targetOdds: input.targetOdds ?? null, requestedGames: plannedGames,
      availableGames: selections.length, shortfall: Math.max(0, plannedGames - selections.length),
      schedule: `${dayLabel} (${snapshot.scheduleDate}, Africa/Lagos)`,
      scheduleDate: snapshot.scheduleDate, dayOffset: snapshot.dayOffset,
      selections, combinedOdds: selections.reduce((total, selection) => total * selection.odds, 1),
      averageConfidence: selections.reduce((total, selection) => total + selection.confidence, 0) / selections.length,
      summary: analysis.summary, rejected: snapshot.slip.selections.length - selections.length,
      analysisToken: signAnalysisToken(selections, initData, deps.telegramBotToken!),
    };
  });

  app.post('/api/miniapp/code', async (request, reply) => {
    const input = codeSchema.parse(request.body);
    const initData = request.headers['x-telegram-init-data'] as string;
    if (!verifyAnalysisToken(input.analysisToken, input.selections, initData, deps.telegramBotToken!)) {
      return reply.unauthorized('Your AI analysis expired. Reanalyze the slip before creating a code.');
    }
    const candidates = input.selections.map(toCandidate);
    const preparation = await new SportyBetSlipBuilder(deps.sportyBet).prepare(candidates);
    if (preparation.status === 'unavailable') return reply.conflict(`Market unavailable: ${preparation.reason}`);
    if (preparation.status === 'odds_changed' && !input.acceptOddsChange) {
      return reply.status(409).send({ status: 'odds_changed',
        previousOdds: preparation.previousOdds, currentOdds: preparation.currentOdds });
    }
    const code = await deps.sportyBet.createBookingCode(preparation.selections);
    return { status: 'ready', code, odds: preparation.currentOdds, selections: candidates.length };
  });

  app.post('/api/miniapp/read-code', async (request) => {
    const { code } = z.object({ code: z.string().regex(/^[A-Za-z0-9]{4,20}$/) }).parse(request.body);
    const selections = await deps.sportyBet.resolveBookingCode(code);
    return { code: code.toUpperCase(), selections: selections.length,
      combinedOdds: selections.reduce((total, selection) => total * selection.odds, 1) };
  });
  app.post('/api/miniapp/x-post', async (request) => {
    const { url } = z.object({ url: z.string().url().max(500) }).parse(request.body);
    return new XPostReader().read(url);
  });
  app.post('/api/miniapp/screenshot', async (request) => {
    const input = z.object({ data: z.string().max(8_000_000),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).parse(request.body);
    const bytes = Uint8Array.from(Buffer.from(input.data, 'base64'));
    if (bytes.byteLength > 6_000_000) throw new Error('Screenshot is too large.');
    return deps.screenshotAnalyzer.analyze(bytes, input.mimeType);
  });
}
