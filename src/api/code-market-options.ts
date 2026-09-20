import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SportyBetProvider } from '../sportybet/contracts.js';

const schema = z.object({ eventId: z.string().min(1).max(100),
  sport: z.enum(['football', 'basketball', 'tennis', 'handball']) }).strict();

/** Exact provider selection IDs and line specifiers; an available price is NOT a recommendation. */
export function registerCodeMarketOptions(app: FastifyInstance, provider: SportyBetProvider): void {
  app.post('/api/miniapp/code-options', async (request, reply) => {
    const { eventId, sport } = schema.parse(request.body);
    const checkedAt = new Date();
    const fixture = await provider.getEvent(eventId);
    if (!fixture || fixture.providerEventId !== eventId || fixture.status !== 'scheduled' ||
      fixture.startsAt.getTime() <= checkedAt.getTime()) {
      return reply.conflict('The fixture is unavailable or has already started.');
    }
    const markets = await provider.getMarkets(eventId);
    const active = markets.filter((market) => market.eventId === eventId &&
      market.sport === sport && market.status === 'active' &&
      Number.isFinite(market.odds) && market.odds > 1.01 && market.odds <= 1000)
      .sort((a, b) => a.marketName.localeCompare(b.marketName) ||
        a.selectionName.localeCompare(b.selectionName) || a.odds - b.odds);
    return { fixture: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
      checkedAt: checkedAt.toISOString(), source: 'SportyBet market feed',
      totalActive: active.length, truncated: active.length > 120,
      options: active.slice(0, 120).map((market) => ({
        marketId: market.providerMarketId, selectionId: market.providerSelectionId,
        specifier: market.specifier ?? null, marketName: market.marketName,
        selectionName: market.selectionName, odds: market.odds,
      })),
      warning: 'All current active supplier market types are eligible, including basketball Under. Choosing an option reanalyzes the slip; odds can change before booking.' };
  });
}
