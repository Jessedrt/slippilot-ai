import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import type { ScreenshotAnalyzer } from '../ai/screenshot-analyzer.js';
import { SportyBetSlipBuilder } from '../booking/workflow.js';
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
  sport: z.enum(['football', 'basketball']),
  gameCount: z.number().int().min(1).max(15),
  targetOdds: z.number().min(1.01).max(500).optional(),
  riskMode: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
});

const selectionSchema = z.object({
  eventId: z.string().min(1).max(100),
  marketId: z.string().min(1).max(100),
  selectionId: z.string().min(1).max(100),
  sport: z.enum(['football', 'basketball']),
  league: z.string().max(120),
  homeTeam: z.string().min(1).max(120),
  awayTeam: z.string().min(1).max(120),
  startsAt: z.string().datetime(),
  marketName: z.string().min(1).max(160),
  selectionName: z.string().min(1).max(160),
  odds: z.number().min(1.001).max(1000),
  confidence: z.number().min(0).max(99),
  risk: z.enum(['lower', 'medium', 'higher']),
});

const codeSchema = z.object({
  selections: z.array(selectionSchema).min(1).max(15),
  acceptOddsChange: z.boolean().optional(),
});

type MiniSelection = z.infer<typeof selectionSchema>;

function toCandidate(selection: MiniSelection): CandidateSelection {
  return {
    providerMarketId: selection.marketId,
    providerSelectionId: selection.selectionId,
    eventId: selection.eventId,
    sport: selection.sport,
    category: 'mini-app',
    marketName: selection.marketName,
    selectionName: selection.selectionName,
    odds: selection.odds,
    status: 'active',
    lastUpdated: new Date(),
    fixture: {
      id: selection.eventId,
      providerId: selection.eventId,
      sport: selection.sport,
      league: selection.league,
      homeTeam: selection.homeTeam,
      awayTeam: selection.awayTeam,
      startsAt: new Date(selection.startsAt),
      status: 'scheduled',
    },
    modelProbability: selection.confidence,
    confidenceScore: selection.confidence,
    dataQuality: 'medium',
    riskLevel: selection.risk,
    reasoning: ['AI-reviewed in the SlipPilot Mini App.'],
  };
}

function verifyTelegramInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData);
  const suppliedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!suppliedHash || !Number.isFinite(authDate)) return false;
  if (Math.abs(Date.now() / 1000 - authDate) > 86_400) return false;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
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
      return reply.unauthorized('Open this Mini App from @slippilotbot in Telegram.');
    }
  });
  app.post('/api/miniapp/build', async (request, reply) => {
    const input = buildSchema.parse(request.body);
    const snapshot = await buildLiveSlipSnapshot(
      deps.sportyBet,
      input.sport,
      input.gameCount,
      input.targetOdds,
    );
    const analysis = await deps.slipAnalyzer.analyze(snapshot.slip.selections);
    const selections = snapshot.slip.selections.flatMap((selection, index) => {
      const result = analysis.selections[index];
      if (!result || result.verdict === 'reject') return [];
      return [
        {
          eventId: selection.eventId,
          marketId: selection.providerMarketId,
          selectionId: selection.providerSelectionId,
          sport: selection.sport,
          league: selection.fixture.league,
          homeTeam: selection.fixture.homeTeam,
          awayTeam: selection.fixture.awayTeam,
          startsAt: selection.fixture.startsAt.toISOString(),
          marketName: selection.marketName,
          selectionName: selection.selectionName,
          odds: selection.odds,
          confidence: result.confidence,
          risk: result.risk,
          verdict: result.verdict,
        },
      ];
    });
    if (!selections.length) return reply.conflict('AI rejected every available selection.');
    return {
      slipId: snapshot.slip.id,
      sport: input.sport,
      riskMode: input.riskMode,
      selections,
      combinedOdds: selections.reduce((total, selection) => total * selection.odds, 1),
      averageConfidence:
        selections.reduce((total, selection) => total + selection.confidence, 0) /
        selections.length,
      summary: analysis.summary,
      rejected: snapshot.slip.selections.length - selections.length,
    };
  });

  app.post('/api/miniapp/code', async (request, reply) => {
    const input = codeSchema.parse(request.body);
    const candidates = input.selections.map(toCandidate);
    const analysis = await deps.slipAnalyzer.analyze(candidates);
    if (analysis.selections.some((selection) => selection.verdict === 'reject')) {
      return reply.conflict('AI rejected one or more selections. Rebuild the slip before booking.');
    }
    const preparation = await new SportyBetSlipBuilder(deps.sportyBet).prepare(candidates);
    if (preparation.status === 'unavailable') {
      return reply.conflict(`Market unavailable: ${preparation.reason}`);
    }
    if (preparation.status === 'odds_changed' && !input.acceptOddsChange) {
      return reply.status(409).send({
        status: 'odds_changed',
        previousOdds: preparation.previousOdds,
        currentOdds: preparation.currentOdds,
      });
    }
    const code = await deps.sportyBet.createBookingCode(preparation.selections);
    return { status: 'ready', code, odds: preparation.currentOdds, selections: candidates.length };
  });

  app.post('/api/miniapp/read-code', async (request) => {
    const { code } = z
      .object({ code: z.string().regex(/^[A-Za-z0-9]{4,20}$/) })
      .parse(request.body);
    const selections = await deps.sportyBet.resolveBookingCode(code);
    return {
      code: code.toUpperCase(),
      selections: selections.length,
      combinedOdds: selections.reduce((total, selection) => total * selection.odds, 1),
    };
  });

  app.post('/api/miniapp/x-post', async (request) => {
    const { url } = z.object({ url: z.string().url().max(500) }).parse(request.body);
    return new XPostReader().read(url);
  });

  app.post('/api/miniapp/screenshot', async (request) => {
    const input = z
      .object({
        data: z.string().max(8_000_000),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      })
      .parse(request.body);
    const bytes = Uint8Array.from(Buffer.from(input.data, 'base64'));
    if (bytes.byteLength > 6_000_000) throw new Error('Screenshot is too large.');
    return deps.screenshotAnalyzer.analyze(bytes, input.mimeType);
  });
}
