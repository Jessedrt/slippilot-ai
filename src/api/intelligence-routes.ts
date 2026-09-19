import type { FastifyInstance } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import type { NormalizedMarket } from '../types/domain.js';

const comparisonSchema = z.object({
  eventId: z.string().min(1).max(100),
  sport: z.enum(['football', 'basketball', 'tennis', 'handball']),
  marketId: z.string().max(100).optional(),
  selectionId: z.string().max(100).optional(),
});
const selectedSchema = z.object({
  eventId: z.string().min(1).max(100),
  marketId: z.string().min(1).max(100),
  selectionId: z.string().min(1).max(100),
  sport: z.enum(['football', 'basketball', 'tennis', 'handball']),
  odds: z.number().finite().min(1.001).max(1000),
});
const reliabilitySchema = z.object({
  selections: z.array(selectedSchema).min(1).max(24),
  analysisToken: z.string().min(20).max(131_072),
});
type Selected = z.infer<typeof selectedSchema>;
const marketKey = (selection: Pick<Selected, 'eventId' | 'marketId' | 'selectionId'>) =>
  `${selection.eventId}\u0000${selection.marketId}\u0000${selection.selectionId}`;

/** Confirm that all requested selections belong to a signed slip in this Telegram session. */
function validSlipToken(token: string, selections: Selected[], initData: string, secret: string): boolean {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', secret)
    .update(`aurex-miniapp-analysis-v1.${payload}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const claim: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const parsed = z.object({ expiresAt: z.number(), session: z.string(),
      selections: z.array(z.string()) }).parse(claim);
    const session = createHash('sha256').update(initData).digest('base64url');
    const approved = new Set(parsed.selections);
    return parsed.expiresAt >= Date.now() && parsed.session === session &&
      selections.every((item) => approved.has(marketKey(item)));
  } catch { return false; }
}

/** Updated-at is supplied by the adapter. When the provider omits it, its adapter uses retrieval time. */
function marketTime(market: NormalizedMarket, checkedAt: Date) {
  const timestamp = market.lastUpdated instanceof Date ? market.lastUpdated.getTime() : NaN;
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > checkedAt.getTime() + 120_000) {
    return { lastUpdated: null, ageSeconds: null, freshness: 'unknown' as const };
  }
  const ageSeconds = Math.max(0, Math.floor((checkedAt.getTime() - timestamp) / 1000));
  const freshness = ageSeconds <= 120 ? 'recent' as const :
    ageSeconds <= 600 ? 'aging' as const : 'stale' as const;
  return { lastUpdated: new Date(timestamp).toISOString(), ageSeconds, freshness };
}
function compareRow(market: NormalizedMarket, checkedAt: Date) {
  return {
    marketId: market.providerMarketId, selectionId: market.providerSelectionId,
    category: market.category, marketName: market.marketName,
    selectionName: market.selectionName, odds: market.odds, status: market.status,
    ...marketTime(market, checkedAt),
  };
}

/** These read-only routes inherit the verified Telegram init-data preHandler. No odds or AI scores are fabricated. */
export function registerIntelligenceRoutes(
  app: FastifyInstance,
  deps: { sportyBet: SportyBetProvider; telegramBotToken?: string },
): void {
  app.post('/api/miniapp/compare-markets', async (request, reply) => {
    const input = comparisonSchema.parse(request.body);
    const checkedAt = new Date();
    const event = await deps.sportyBet.getEvent(input.eventId);
    if (!event) return reply.notFound('Fixture not returned by the provider.');
    const markets = (await deps.sportyBet.getMarkets(input.eventId))
      .filter((market) => market.eventId === input.eventId && market.sport === input.sport);
    const active = markets.filter((market) => market.status === 'active' &&
      Number.isFinite(market.odds) && market.odds > 1.01 && market.odds <= 1000)
      .sort((a, b) => a.marketName.localeCompare(b.marketName) ||
        a.selectionName.localeCompare(b.selectionName));
    const selected = active.find((market) => market.providerMarketId === input.marketId &&
      market.providerSelectionId === input.selectionId);
    const counts = new Map<string, number>();
    const alternatives = active.filter((market) => {
      const count = counts.get(market.providerMarketId) ?? 0;
      if (count >= 2) return false;
      counts.set(market.providerMarketId, count + 1);
      return true;
    }).slice(0, 24);
    if (selected && !alternatives.includes(selected)) alternatives.unshift(selected);
    return {
      eventId: event.providerEventId, fixture: {
        homeTeam: event.homeTeam, awayTeam: event.awayTeam,
        league: event.league || 'Competition not supplied',
        startsAt: event.startsAt.toISOString(), status: event.status,
      }, sport: input.sport, checkedAt: checkedAt.toISOString(), source: 'SportyBet market feed',
      selected: selected ? compareRow(selected, checkedAt) : null,
      alternatives: alternatives.slice(0, 24).map((market) => compareRow(market, checkedAt)),
      totalActive: active.length,
      warnings: [
        ...(event.status !== 'scheduled' || event.startsAt.getTime() <= checkedAt.getTime()
          ? ['This fixture is no longer a future scheduled match; these are not pre-match recommendations.'] : []),
        ...(input.marketId && !selected ? ['The originally selected market was not found active in the current provider response.'] : []),
        ...(!active.length ? ['No active markets were returned for this fixture and sport.'] : []),
        'Market timestamps may reflect retrieval time when the supplier does not give an update time. Prices can change; comparisons are not AI verdicts or booking guarantees.',
      ],
    };
  });

  app.post('/api/miniapp/reliability', async (request, reply) => {
    const input = reliabilitySchema.parse(request.body);
    const initData = request.headers['x-telegram-init-data'];
    if (!deps.telegramBotToken || typeof initData !== 'string' ||
      !validSlipToken(input.analysisToken, input.selections, initData, deps.telegramBotToken)) {
      return reply.unauthorized('This analysis is expired or does not match the current slip. Build a new slip.');
    }
    const checkedAt = new Date();
    const events = new Map<string, { event: Awaited<ReturnType<SportyBetProvider['getEvent']>>;
      markets: NormalizedMarket[]; error: boolean }>();
    for (const id of new Set(input.selections.map((item) => item.eventId))) {
      try {
        const [event, markets] = await Promise.all([
          deps.sportyBet.getEvent(id), deps.sportyBet.getMarkets(id),
        ]);
        events.set(id, { event, markets, error: false });
      } catch {
        events.set(id, { event: null, markets: [], error: true });
      }
    }
    const selections = input.selections.map((item, index) => {
      const snapshot = events.get(item.eventId)!;
      const market = snapshot.markets.find((candidate) =>
        candidate.eventId === item.eventId && candidate.sport === item.sport &&
        candidate.providerMarketId === item.marketId &&
        candidate.providerSelectionId === item.selectionId);
      const future = snapshot.event?.status === 'scheduled' &&
        snapshot.event.startsAt.getTime() > checkedAt.getTime();
      const available = Boolean(future && market?.status === 'active' &&
        Number.isFinite(market.odds) && market.odds > 1.01);
      const warnings: string[] = [];
      if (snapshot.error) warnings.push('Provider unavailable: fixture and odds cannot be verified.');
      else if (!snapshot.event) warnings.push('Fixture missing from the current provider response.');
      else if (!future) warnings.push('Fixture is no longer a future scheduled match.');
      if (!snapshot.error && !market) warnings.push('Original market or selection is missing.');
      else if (market && market.status !== 'active') warnings.push('Original market is not active.');
      if (market && Math.abs(market.odds - item.odds) > 0.00001) {
        warnings.push(`Odds changed from ${item.odds.toFixed(2)} to ${market.odds.toFixed(2)}.`);
      }
      const timing = market ? marketTime(market, checkedAt) :
        { lastUpdated: null, ageSeconds: null, freshness: 'unknown' as const };
      if (timing.freshness === 'stale') warnings.push('Market update timestamp is older than ten minutes.');
      if (timing.freshness === 'unknown') warnings.push('A trustworthy market update timestamp is unavailable.');
      return {
        index, eventId: item.eventId, marketId: item.marketId, selectionId: item.selectionId,
        fixtureStatus: snapshot.event?.status ?? 'unverified',
        available, previousOdds: item.odds, currentOdds: market?.odds ?? null,
        ...timing, warnings,
      };
    });
    const verified = selections.filter((item) => item.available &&
      item.freshness !== 'stale' && item.freshness !== 'unknown' &&
      !item.warnings.some((warning) => warning.startsWith('Odds changed'))).length;
    return {
      checkedAt: checkedAt.toISOString(), source: 'SportyBet event and market feed',
      analysisSource: 'Existing AUREX AI slip analysis; no new AI analysis performed here',
      verified, total: selections.length, selections,
      missingData: [
        'This check does not independently verify injuries, team news, confirmed lineups, or model calibration.',
        'Provider market timestamps may be retrieval-time fallbacks when a last-change timestamp is unavailable.',
        'Results can change immediately. Reanalyze and refresh odds before preparing a booking code.',
      ],
    };
  });
}
