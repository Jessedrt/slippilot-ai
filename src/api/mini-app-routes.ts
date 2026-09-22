import type { FastifyInstance } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SlipAnalyzer } from '../ai/slip-analyzer.js';
import { MIN_AI_QUALITY_SCORE, passesAiQuality } from '../ai/quality-gate.js';
import { minimumQualityForTarget } from '../ai/quality-policy.js';
import type { ScreenshotAnalyzer } from '../ai/screenshot-analyzer.js';
import { SportyBetSlipBuilder } from '../booking/workflow.js';
import { automaticLegCount } from '../slips/odds-target.js';
import { buildReviewedLiveSlipSnapshot } from '../sportybet/market-review.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { CandidateSelection } from '../types/domain.js';
import { XPostReader } from '../social/x-post-reader.js';
import {
  BasketballEvidenceError,
  type BasketballStatisticsProvider,
} from '../sports/basketball-statistics.js';

export interface MiniAppDependencies {
  sportyBet: SportyBetProvider;
  slipAnalyzer: SlipAnalyzer;
  screenshotAnalyzer: ScreenshotAnalyzer;
  telegramBotToken?: string;
  basketballStatistics?: BasketballStatisticsProvider;
}
const buildSchema = z
  .object({
    sport: z.enum(['football', 'basketball', 'tennis', 'handball']),
    gameCount: z.number().int().positive().safe().optional(),
    targetOdds: z.number().finite().min(1.01).optional(),
    todayOnly: z.boolean().optional().default(true),
    riskMode: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  })
  .refine((input) => input.targetOdds !== undefined || input.gameCount !== undefined, {
    message: 'Enter target odds of at least 1.01.',
    path: ['targetOdds'],
  });
const selectionSchema = z
  .object({
    eventId: z.string().min(1).max(100),
    marketId: z.string().min(1).max(100),
    selectionId: z.string().min(1).max(100),
    specifier: z.string().max(200).nullable().optional(),
    sport: z.enum(['football', 'basketball', 'tennis', 'handball']),
    league: z.string().max(120),
    homeTeam: z.string().min(1).max(120),
    awayTeam: z.string().min(1).max(120),
    startsAt: z.string().datetime(),
    marketName: z.string().min(1).max(160),
    selectionName: z.string().min(1).max(160),
    odds: z.number().min(1.001).max(1000),
    confidence: z.number().min(0).max(100),
    evidenceQualityScore: z.number().min(0).max(100).optional(),
    statisticalSupport: z.literal('supported').optional(),
    verdict: z.literal('keep').optional(),
    analysisExpiresAt: z.string().datetime().optional(),
    statisticalProjection: z.number().finite().optional(),
    bookmakerImpliedProbability: z.number().finite().min(0).max(100).optional(),
    risk: z.enum(['lower', 'medium', 'higher']),
  })
  .strict();
const codeSchema = z.object({
  selections: z.array(selectionSchema).min(1),
  analysisToken: z.string().min(20).max(131_072),
  acceptOddsChange: z.boolean().optional(),
  maximumOdds: z.number().finite().min(1.01).max(1_000_000_000).optional(),
});
type MiniSelection = z.infer<typeof selectionSchema>;
const ANALYSIS_TOKEN_TTL_MS = 30 * 60 * 1000;
interface AnalysisTokenPayload {
  expiresAt: number;
  session: string;
  selections: string[];
  minimumScore?: number;
  reviews?: string[];
}
function selectionKey(selection: MiniSelection): string {
  const identity = `${selection.eventId}\u0000${selection.marketId}\u0000${selection.selectionId}`;
  return selection.specifier == null ? identity : `${identity}\u0000${selection.specifier}`;
}
const reviewKey = (selection: MiniSelection): string =>
  [
    selectionKey(selection),
    selection.odds,
    selection.evidenceQualityScore ?? selection.confidence,
    selection.statisticalSupport ?? 'supported',
    selection.verdict ?? 'keep',
    selection.analysisExpiresAt ?? 'legacy',
  ].join('\u0000');
function sessionKey(initData: string): string {
  return createHash('sha256').update(initData).digest('base64url');
}
function signAnalysisToken(
  selections: MiniSelection[],
  initData: string,
  botToken: string,
  minimumScore: number,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      expiresAt: Date.now() + ANALYSIS_TOKEN_TTL_MS,
      session: sessionKey(initData),
      selections: selections.map(selectionKey),
      reviews: selections.map(reviewKey),
      minimumScore,
    } satisfies AnalysisTokenPayload),
  ).toString('base64url');
  const signature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}
/** Return the signed minimum, never a client-supplied target; old tokens stay strict. */
function verifyAnalysisToken(
  token: string,
  selections: MiniSelection[],
  initData: string,
  botToken: string,
): number | null {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra) return null;
  const expectedSignature = createHmac('sha256', botToken)
    .update(`aurex-miniapp-analysis-v1.${payload}`)
    .digest('base64url');
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claim = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as AnalysisTokenPayload;
    if (
      claim.expiresAt < Date.now() ||
      claim.session !== sessionKey(initData) ||
      !Array.isArray(claim.selections)
    )
      return null;
    const minimum = claim.minimumScore ?? MIN_AI_QUALITY_SCORE;
    if (![50, 55, 60, 68].includes(minimum)) return null;
    const approved = new Set(claim.selections);
    if (!selections.every((selection) => approved.has(selectionKey(selection)))) return null;
    if (claim.reviews) {
      const reviews = new Set(claim.reviews);
      if (!selections.every((selection) => reviews.has(reviewKey(selection)))) return null;
    }
    return minimum;
  } catch {
    return null;
  }
}
function toCandidate(selection: MiniSelection): CandidateSelection {
  return {
    providerMarketId: selection.marketId,
    providerSelectionId: selection.selectionId,
    ...(selection.specifier != null ? { specifier: selection.specifier } : {}),
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
    modelProbability: 0,
    confidenceScore: selection.confidence,
    dataQuality: 'medium',
    riskLevel: selection.risk,
    reasoning: ['AI-reviewed in the AUREX Mini App. Quality scores are not outcome probabilities.'],
    assessment: {
      evidenceQualityScore: selection.evidenceQualityScore ?? selection.confidence,
      statisticalSupport: selection.statisticalSupport ?? 'supported',
      recommendationVerdict: selection.verdict ?? 'keep',
      assessedAt: new Date(),
      expiresAt: selection.analysisExpiresAt
        ? new Date(selection.analysisExpiresAt)
        : new Date(Date.now() + 5 * 60_000),
      sources: [],
      conflictingEvidence: false,
      ...(selection.statisticalProjection != null
        ? { statisticalProjection: selection.statisticalProjection }
        : {}),
      bookmakerImpliedProbability:
        selection.bookmakerImpliedProbability ?? Number((100 / selection.odds).toFixed(2)),
    },
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
    .sort(([a], [b]) => a.localeCompare(b))
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
      return reply.unauthorized('Open AUREX through its Telegram Mini App launcher.');
    }
  });
  app.post('/api/miniapp/build', async (request, reply) => {
    const input = buildSchema.parse(request.body);
    const minimum = minimumQualityForTarget(input.targetOdds, input.riskMode);
    const plannedGames =
      input.targetOdds === undefined
        ? input.gameCount!
        : automaticLegCount(input.targetOdds, input.riskMode);
    let snapshot;
    try {
      snapshot = await buildReviewedLiveSlipSnapshot(
        deps.sportyBet,
        deps.slipAnalyzer,
        input.sport,
        plannedGames,
        input.targetOdds,
        input.riskMode,
        deps.basketballStatistics,
      );
    } catch (error) {
      if (!(error instanceof BasketballEvidenceError)) throw error;
      return reply.status(error.statusCode).send({
        status: 'basketball_totals_unavailable',
        reason: error.reasonCode,
        message: `${error.message} Try another sport. No slip or booking code was created.`,
      });
    }
    const analysis = snapshot.analysis;
    const selections = snapshot.slip.selections
      .flatMap((selection, index) => {
        const result = analysis.selections[index];
        if (!result || !passesAiQuality(result, minimum)) return [];
        return [
          {
            eventId: selection.eventId,
            marketId: selection.providerMarketId,
            selectionId: selection.providerSelectionId,
            ...(selection.specifier != null ? { specifier: selection.specifier } : {}),
            sport: selection.sport,
            league: selection.fixture.league,
            homeTeam: selection.fixture.homeTeam,
            awayTeam: selection.fixture.awayTeam,
            startsAt: selection.fixture.startsAt.toISOString(),
            marketName: selection.marketName,
            selectionName: selection.selectionName,
            odds: selection.odds,
            confidence: result.evidenceQualityScore ?? result.confidence,
            evidenceQualityScore: result.evidenceQualityScore ?? result.confidence,
            statisticalSupport: 'supported' as const,
            statisticalProjection: selection.assessment?.statisticalProjection,
            bookmakerImpliedProbability:
              selection.assessment?.bookmakerImpliedProbability ??
              Number((100 / selection.odds).toFixed(2)),
            analysisExpiresAt: (
              selection.assessment?.expiresAt ??
              new Date(new Date(analysis.analyzedAt).getTime() + ANALYSIS_TOKEN_TTL_MS)
            ).toISOString(),
            risk: result.risk,
            verdict: 'keep' as const,
          },
        ];
      })
      .sort((left, right) => right.confidence - left.confidence);
    if (!selections.length)
      return reply.conflict(
        `No verified selection passed the ${minimum}/100 AI quality minimum. No booking code was prepared.`,
      );
    const initData = request.headers['x-telegram-init-data'] as string;
    const dayLabel = ['today', 'tomorrow', 'the following day'][snapshot.dayOffset];
    const combinedOdds = selections.reduce((total, selection) => total * selection.odds, 1);
    const targetReached = input.targetOdds == null || combinedOdds >= input.targetOdds;
    return {
      slipId: snapshot.slip.id,
      sport: input.sport,
      riskMode: input.riskMode,
      targetOdds: input.targetOdds ?? null,
      qualityMinimum: minimum,
      requestedGames: plannedGames,
      availableGames: selections.length,
      shortfall: Math.max(0, plannedGames - selections.length),
      schedule: `${dayLabel} (${snapshot.scheduleDate}, Africa/Lagos)`,
      scheduleDate: snapshot.scheduleDate,
      dayOffset: snapshot.dayOffset,
      selections,
      combinedOdds,
      targetReached,
      targetStatus: targetReached ? 'reached' : 'not_reached',
      targetMessage: targetReached
        ? 'Requested target reached by eligible selections.'
        : 'Target odds not reached; unsupported markets were not added to force the target.',
      averageConfidence:
        selections.reduce((total, selection) => total + selection.confidence, 0) /
        selections.length,
      summary: analysis.summary,
      rejected: snapshot.rejectedOptions,
      reviewedOptions: snapshot.reviewedOptions,
      analysisToken: signAnalysisToken(selections, initData, deps.telegramBotToken!, minimum),
    };
  });

  app.post('/api/miniapp/code', async (request, reply) => {
    const input = codeSchema.parse(request.body);
    const initData = request.headers['x-telegram-init-data'] as string;
    const minimum = verifyAnalysisToken(
      input.analysisToken,
      input.selections,
      initData,
      deps.telegramBotToken!,
    );
    if (minimum === null) {
      return reply.unauthorized(
        'Your AI analysis expired. Reanalyze the slip before creating a code.',
      );
    }
    if (
      input.selections.some(
        (selection) =>
          (selection.evidenceQualityScore ?? selection.confidence) < minimum ||
          (selection.verdict != null && selection.verdict !== 'keep') ||
          (selection.statisticalSupport != null && selection.statisticalSupport !== 'supported'),
      )
    ) {
      return reply.conflict(
        `A selection is below the ${minimum}/100 AI quality pass mark. Remove it and reanalyze before generating a code.`,
      );
    }
    // The booking provider receives the analyzed games in descending evidence-quality order.
    const candidates = [...input.selections]
      .sort((left, right) => right.confidence - left.confidence)
      .map(toCandidate);
    const preparation = await new SportyBetSlipBuilder(deps.sportyBet).prepare(candidates);
    if (preparation.status === 'unavailable')
      return reply.conflict(`Market unavailable: ${preparation.reason}`);
    // The provider's refreshed odds, not stale client odds, determine the cap.
    // Enforce this even when the user previously accepted a different odds update.
    if (input.maximumOdds !== undefined && preparation.currentOdds > input.maximumOdds + 0.000001) {
      return reply.status(409).send({
        status: 'target_exceeded',
        message: `Live combined odds ${preparation.currentOdds.toFixed(2)} exceed your maximum ${input.maximumOdds.toFixed(2)}. Trim again or change the target. No code was created.`,
        currentOdds: preparation.currentOdds,
        maximumOdds: input.maximumOdds,
      });
    }
    if (preparation.status === 'odds_changed' && !input.acceptOddsChange) {
      return reply.status(409).send({
        status: 'odds_changed',
        previousOdds: preparation.previousOdds,
        currentOdds: preparation.currentOdds,
      });
    }
    const code = await new SportyBetSlipBuilder(deps.sportyBet).createCode(
      preparation,
      Boolean(input.acceptOddsChange),
    );
    return {
      status: 'booking_code_created',
      code,
      odds: preparation.currentOdds,
      selections: candidates.length,
      betPlaced: false,
      message: 'Booking code created. No wager was placed.',
    };
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
